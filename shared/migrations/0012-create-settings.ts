import { DataTypes, type QueryInterface } from "sequelize";

export const up = async ({ context: queryInterface }: { context: QueryInterface }) => {
  await queryInterface.createTable("settings", {
    id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
    scope: { type: DataTypes.STRING, allowNull: false },
    groupId: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: "groups", key: "id" },
      onDelete: "CASCADE",
    },
    jurisdictionId: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: "jurisdictions", key: "id" },
      onDelete: "CASCADE",
    },
    key: { type: DataTypes.STRING, allowNull: false },
    value: { type: DataTypes.JSONB, allowNull: false },
    dataType: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false },
  });

  // One partial unique index per scope — avoids the classic gotcha where a plain
  // unique(scope, groupId, jurisdictionId, key) index lets multiple NULLs coexist.
  await queryInterface.addIndex("settings", ["key"], {
    unique: true,
    name: "settings_global_scope_unique",
    where: { scope: "global" },
  });
  await queryInterface.addIndex("settings", ["groupId", "key"], {
    unique: true,
    name: "settings_group_scope_unique",
    where: { scope: "group" },
  });
  await queryInterface.addIndex("settings", ["jurisdictionId", "key"], {
    unique: true,
    name: "settings_jurisdiction_scope_unique",
    where: { scope: "jurisdiction" },
  });
};

export const down = async ({ context: queryInterface }: { context: QueryInterface }) => {
  await queryInterface.dropTable("settings");
};
