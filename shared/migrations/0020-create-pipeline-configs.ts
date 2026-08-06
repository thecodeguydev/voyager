import { DataTypes, type QueryInterface } from "sequelize";

// No seed rows: a jurisdiction with no row here falls back to Phase 2's behavior in
// engine/src/settingsCache.ts, so this table is never a hard dependency of dispatch.
export const up = async ({ context: queryInterface }: { context: QueryInterface }) => {
  await queryInterface.createTable("pipeline_configs", {
    id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
    jurisdictionId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "jurisdictions", key: "id" },
      onDelete: "CASCADE",
    },
    preset: { type: DataTypes.STRING, allowNull: false },
    stages: { type: DataTypes.JSONB, allowNull: false },
    enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false },
  });

  await queryInterface.addIndex("pipeline_configs", ["jurisdictionId"], {
    unique: true,
    name: "pipeline_configs_jurisdiction_unique",
  });
};

export const down = async ({ context: queryInterface }: { context: QueryInterface }) => {
  await queryInterface.dropTable("pipeline_configs");
};
