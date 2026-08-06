import { DataTypes, type QueryInterface } from "sequelize";

export const up = async ({ context: queryInterface }: { context: QueryInterface }) => {
  await queryInterface.createTable("metric_definitions", {
    id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
    key: { type: DataTypes.STRING, allowNull: false, unique: true },
    name: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    unit: { type: DataTypes.STRING, allowNull: false },
    type: { type: DataTypes.STRING, allowNull: false },
    builtin: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    aggregation: { type: DataTypes.STRING, allowNull: false },
    jurisdictionId: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: "jurisdictions", key: "id" },
      onDelete: "CASCADE",
    },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false },
  });
};

export const down = async ({ context: queryInterface }: { context: QueryInterface }) => {
  await queryInterface.dropTable("metric_definitions");
};
