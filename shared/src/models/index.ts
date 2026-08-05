import type { Sequelize } from "sequelize";
import { Group, initGroupModel } from "./Group.js";
import { Jurisdiction, initJurisdictionModel } from "./Jurisdiction.js";
import { Zone, initZoneModel } from "./Zone.js";
import { Worker, initWorkerModel } from "./Worker.js";
import { ZoneWorker, initZoneWorkerModel } from "./ZoneWorker.js";
import { Schedule, initScheduleModel } from "./Schedule.js";
import { Order, initOrderModel } from "./Order.js";
import { DispatchQueue, initDispatchQueueModel } from "./DispatchQueue.js";
import { Assignment, initAssignmentModel } from "./Assignment.js";
import { Setting, initSettingModel } from "./Setting.js";
import { AuditLog, initAuditLogModel } from "./AuditLog.js";
import { WebhookSource, initWebhookSourceModel } from "./WebhookSource.js";
import { WebhookEvent, initWebhookEventModel } from "./WebhookEvent.js";

export * from "./geo.js";
export * from "./Group.js";
export * from "./Jurisdiction.js";
export * from "./Zone.js";
export * from "./Worker.js";
export * from "./ZoneWorker.js";
export * from "./Schedule.js";
export * from "./Order.js";
export * from "./DispatchQueue.js";
export * from "./Assignment.js";
export * from "./Setting.js";
export * from "./AuditLog.js";
export * from "./WebhookSource.js";
export * from "./WebhookEvent.js";

const initializedSequelizes = new WeakSet<Sequelize>();

/**
 * Initializes every model against `sequelize` and wires up associations. One source of
 * truth for api + engine. Idempotent per sequelize instance so callers (the app, the seed
 * loader, tests) can each call it without redefining associations twice.
 */
export function initModels(sequelize: Sequelize) {
  if (initializedSequelizes.has(sequelize)) {
    return {
      Group,
      Jurisdiction,
      Zone,
      Worker,
      ZoneWorker,
      Schedule,
      Order,
      DispatchQueue,
      Assignment,
      Setting,
      AuditLog,
      WebhookSource,
      WebhookEvent,
    };
  }
  initializedSequelizes.add(sequelize);

  initGroupModel(sequelize);
  initJurisdictionModel(sequelize);
  initZoneModel(sequelize);
  initWorkerModel(sequelize);
  initZoneWorkerModel(sequelize);
  initScheduleModel(sequelize);
  initOrderModel(sequelize);
  initDispatchQueueModel(sequelize);
  initAssignmentModel(sequelize);
  initSettingModel(sequelize);
  initAuditLogModel(sequelize);
  initWebhookSourceModel(sequelize);
  initWebhookEventModel(sequelize);

  Group.hasMany(Jurisdiction, { 
    "foreignKey": "groupId", 
    "as": "jurisdictions" 
  });
  
  Jurisdiction.belongsTo(Group, { 
    "foreignKey": "groupId", 
    "as": "group" 
  });

  Jurisdiction.hasMany(Zone, { 
    "foreignKey": "jurisdictionId", 
    "as": "zones" 
  });

  Zone.belongsTo(Jurisdiction, { 
    "foreignKey": "jurisdictionId", 
    "as": "jurisdiction" 
  });

  Jurisdiction.hasMany(Worker, { 
    "foreignKey": "jurisdictionId", 
    "as": "workers" 
  });
  Worker.belongsTo(Jurisdiction, { 
    "foreignKey": "jurisdictionId", 
    "as": "jurisdiction" 
  });

  Jurisdiction.hasMany(Order, { 
    "foreignKey": "jurisdictionId", 
    "as": "orders" 
  });
  Order.belongsTo(Jurisdiction, { 
    "foreignKey": "jurisdictionId", 
    "as": "jurisdiction" 
  });

  Jurisdiction.hasMany(DispatchQueue, { 
    "foreignKey": "jurisdictionId", 
    "as": "dispatchQueueEntries" 
  });
  DispatchQueue.belongsTo(Jurisdiction, { 
    "foreignKey": "jurisdictionId", 
    "as": "jurisdiction" 
  });

  Worker.belongsToMany(Zone, { 
    "through": ZoneWorker, 
    "foreignKey": "workerId", 
    "otherKey": "zoneId", 
    "as": "zones" 
  });

  Zone.belongsToMany(Worker, { 
    "through": ZoneWorker, 
    "foreignKey": "zoneId", 
    "otherKey": "workerId", 
    "as": "workers" 
  });

  Worker.hasMany(Schedule, { 
    "foreignKey": "workerId", 
    "as": "schedules" 
  });
  Schedule.belongsTo(Worker, { 
    "foreignKey": "workerId", 
    "as": "worker" 
  });

  Order.hasMany(DispatchQueue, {
    "foreignKey": "orderId",
    "as": "dispatchQueueEntries"
  });

  DispatchQueue.belongsTo(Order, {
    "foreignKey": "orderId",
    "as": "order"
  });

  Order.hasMany(Assignment, { foreignKey: "orderId", as: "assignments" });
  Assignment.belongsTo(Order, { foreignKey: "orderId", as: "order" });

  Worker.hasMany(Assignment, { foreignKey: "workerId", as: "assignments" });
  Assignment.belongsTo(Worker, { foreignKey: "workerId", as: "worker" });

  Jurisdiction.hasMany(Assignment, { foreignKey: "jurisdictionId", as: "assignments" });
  Assignment.belongsTo(Jurisdiction, { foreignKey: "jurisdictionId", as: "jurisdiction" });

  Group.hasMany(Setting, { foreignKey: "groupId", as: "settings" });
  Setting.belongsTo(Group, { foreignKey: "groupId", as: "group" });

  Jurisdiction.hasMany(Setting, { foreignKey: "jurisdictionId", as: "settings" });
  Setting.belongsTo(Jurisdiction, { foreignKey: "jurisdictionId", as: "jurisdiction" });

  Group.hasMany(AuditLog, { foreignKey: "groupId", as: "auditLogEntries" });
  AuditLog.belongsTo(Group, { foreignKey: "groupId", as: "group" });

  Jurisdiction.hasMany(AuditLog, { foreignKey: "jurisdictionId", as: "auditLogEntries" });
  AuditLog.belongsTo(Jurisdiction, { foreignKey: "jurisdictionId", as: "jurisdiction" });

  Group.hasMany(WebhookSource, { foreignKey: "groupId", as: "webhookSources" });
  WebhookSource.belongsTo(Group, { foreignKey: "groupId", as: "group" });

  WebhookSource.hasMany(WebhookEvent, { foreignKey: "sourceId", as: "events" });
  WebhookEvent.belongsTo(WebhookSource, { foreignKey: "sourceId", as: "source" });

  Group.hasMany(WebhookEvent, { foreignKey: "groupId", as: "webhookEvents" });
  WebhookEvent.belongsTo(Group, { foreignKey: "groupId", as: "group" });

  return {
    Group,
    Jurisdiction,
    Zone,
    Worker,
    ZoneWorker,
    Schedule,
    Order,
    DispatchQueue,
    Assignment,
    Setting,
    AuditLog,
    WebhookSource,
    WebhookEvent,
  };
}

export type Models = ReturnType<typeof initModels>;
