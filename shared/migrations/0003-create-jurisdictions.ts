import { DataTypes, type QueryInterface } from "sequelize";

export const up = async ({ context: queryInterface }: { context: QueryInterface }) => {
  await queryInterface.createTable("jurisdictions", {
    id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
    groupId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "groups", key: "id" },
      onDelete: "CASCADE",
    },
    name: { type: DataTypes.STRING, allowNull: false },
    code: { type: DataTypes.STRING, allowNull: false },
    timezone: { type: DataTypes.STRING, allowNull: false },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "active" },
    settingsVersion: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false },
  });

  await queryInterface.addIndex("jurisdictions", ["groupId", "code"], {
    unique: true,
    name: "jurisdictions_group_id_code_unique",
  });
};

export const down = async ({ context: queryInterface }: { context: QueryInterface }) => {
  await queryInterface.dropTable("jurisdictions");
};
