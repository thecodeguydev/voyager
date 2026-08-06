import type { Sequelize, Transaction, WhereOptions } from "sequelize";
import type { Models } from "../models/index.js";
import type { AuditLog } from "../models/AuditLog.js";
import type { Setting, SettingScope } from "../models/Setting.js";

export interface UpsertSettingInput {
  scope: SettingScope;
  groupId?: string | null;
  jurisdictionId?: string | null;
  key: string;
  value: unknown;
  dataType?: string;
  description?: string | null;
}

export interface ListSettingsFilter {
  scope?: SettingScope;
  groupId?: string;
  jurisdictionId?: string;
}

/**
 * Resolves and mutates settings per the global -> group -> jurisdiction cascade
 * (most-specific-wins), shared by api and engine so resolution logic has one source
 * of truth. See PLAN.md "Settings & configuration" / "Settings hot-reload".
 */
export class SettingsService {
  constructor(
    private readonly sequelize: Sequelize,
    private readonly models: Models,
  ) {}

  /** Effective Setting row for `key` in jurisdiction/group context, or null when unset at every scope. */
  async resolveEntry(
    key: string,
    context: { jurisdictionId?: string; groupId?: string } = {},
  ): Promise<Setting | null> {
    let { groupId } = context;
    const { jurisdictionId } = context;

    if (jurisdictionId && !groupId) {
      const jurisdiction = await this.models.Jurisdiction.findByPk(jurisdictionId, {
        attributes: ["groupId"],
      });
      groupId = jurisdiction?.groupId;
    }

    if (jurisdictionId) {
      const row = await this.models.Setting.findOne({
        where: { scope: "jurisdiction", jurisdictionId, key },
      });
      if (row) return row;
    }

    if (groupId) {
      const row = await this.models.Setting.findOne({ where: { scope: "group", groupId, key } });
      if (row) return row;
    }

    return this.models.Setting.findOne({ where: { scope: "global", key } });
  }

  /** Effective value for `key` given a jurisdiction and/or group context, or undefined if unset anywhere. */
  async resolve(
    key: string,
    context: { jurisdictionId?: string; groupId?: string } = {},
  ): Promise<unknown> {
    const setting = await this.resolveEntry(key, context);
    return setting?.value;
  }

  /** Finds the single Setting row at an exact scope, or null if it doesn't exist yet. */
  async findByScope(input: {
    scope: SettingScope;
    groupId?: string | null;
    jurisdictionId?: string | null;
    key: string;
  }): Promise<Setting | null> {
    return this.models.Setting.findOne({ where: this.scopeWhere(input) });
  }

  async list(filter: ListSettingsFilter = {}): Promise<Setting[]> {
    const where: WhereOptions<Setting> = {};
    if (filter.scope) where.scope = filter.scope;
    if (filter.groupId) where.groupId = filter.groupId;
    if (filter.jurisdictionId) where.jurisdictionId = filter.jurisdictionId;
    return this.models.Setting.findAll({ where });
  }

  /** Creates or updates the setting at its scope, auditing the change and bumping settingsVersion. */
  async upsert(input: UpsertSettingInput, actor: string): Promise<Setting> {
    return this.sequelize.transaction(async (transaction) => {
      const existing = await this.models.Setting.findOne({
        where: this.scopeWhere(input),
        transaction,
      });
      const before = existing ? existing.toJSON() : null;

      const setting = existing
        ? await existing.update(
            {
              value: input.value,
              dataType: input.dataType ?? existing.dataType,
              description: input.description ?? existing.description,
            },
            { transaction },
          )
        : await this.models.Setting.create(
            {
              scope: input.scope,
              groupId: input.groupId ?? null,
              jurisdictionId: input.jurisdictionId ?? null,
              key: input.key,
              value: input.value,
              dataType: input.dataType ?? typeof input.value,
              description: input.description ?? null,
            },
            { transaction },
          );

      await this.models.AuditLog.create(
        {
          entity: "setting",
          entityId: setting.id,
          groupId: input.groupId ?? null,
          jurisdictionId: input.jurisdictionId ?? null,
          action: existing ? "update" : "create",
          actor,
          reason: null,
          before,
          after: setting.toJSON(),
        },
        { transaction },
      );

      await this.bumpSettingsVersion(input.scope, input.groupId, input.jurisdictionId, transaction);

      return setting;
    });
  }

  async getAuditTrail(settingId: string): Promise<AuditLog[]> {
    return this.models.AuditLog.findAll({
      where: { entity: "setting", entityId: settingId },
      order: [["createdAt", "DESC"]],
    });
  }

  /** Re-applies a prior audit entry's `before` snapshot as a new (also audited) change. */
  async rollback(auditLogId: string, actor: string): Promise<Setting> {
    return this.sequelize.transaction(async (transaction) => {
      const entry = await this.models.AuditLog.findByPk(auditLogId, { transaction });
      if (!entry || entry.entity !== "setting") {
        throw new Error(`No setting audit entry found for id ${auditLogId}`);
      }
      const before = entry.before as
        | { value: unknown; dataType: string; description: string | null }
        | null;
      if (!before) {
        throw new Error(`Audit entry ${auditLogId} has no prior value to roll back to`);
      }

      const setting = await this.models.Setting.findByPk(entry.entityId, { transaction });
      if (!setting) {
        throw new Error(`Setting ${entry.entityId} no longer exists`);
      }

      const beforeSnapshot = setting.toJSON();
      await setting.update(
        { value: before.value, dataType: before.dataType, description: before.description },
        { transaction },
      );

      await this.models.AuditLog.create(
        {
          entity: "setting",
          entityId: setting.id,
          groupId: setting.groupId,
          jurisdictionId: setting.jurisdictionId,
          action: "update",
          actor,
          reason: `rollback to audit entry ${auditLogId}`,
          before: beforeSnapshot,
          after: setting.toJSON(),
        },
        { transaction },
      );

      await this.bumpSettingsVersion(setting.scope, setting.groupId, setting.jurisdictionId, transaction);

      return setting;
    });
  }

  private scopeWhere(input: {
    scope: SettingScope;
    groupId?: string | null;
    jurisdictionId?: string | null;
    key: string;
  }): WhereOptions<Setting> {
    switch (input.scope) {
      case "global":
        return { scope: "global", key: input.key };
      case "group":
        return { scope: "group", groupId: input.groupId, key: input.key };
      case "jurisdiction":
        return { scope: "jurisdiction", jurisdictionId: input.jurisdictionId, key: input.key };
    }
  }

  /** Bumps jurisdictions.settingsVersion for whichever jurisdictions this scope affects. */
  private async bumpSettingsVersion(
    scope: SettingScope,
    groupId: string | null | undefined,
    jurisdictionId: string | null | undefined,
    transaction: Transaction,
  ): Promise<void> {
    if (scope === "jurisdiction" && jurisdictionId) {
      await this.models.Jurisdiction.increment("settingsVersion", {
        by: 1,
        where: { id: jurisdictionId },
        transaction,
      });
    } else if (scope === "group" && groupId) {
      await this.models.Jurisdiction.increment("settingsVersion", {
        by: 1,
        where: { groupId },
        transaction,
      });
    } else if (scope === "global") {
      await this.models.Jurisdiction.increment("settingsVersion", { by: 1, where: {}, transaction });
    }
  }
}
