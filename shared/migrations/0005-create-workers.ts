import { DataTypes, type QueryInterface } from "sequelize";

export const up = async ({ context: queryInterface }: { context: QueryInterface }) => {
  await queryInterface.createTable("workers", {
    id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
    jurisdictionId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "jurisdictions", key: "id" },
      onDelete: "CASCADE",
    },
    externalId: { type: DataTypes.STRING, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    type: { type: DataTypes.STRING, allowNull: false },
    skills: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    maxConcurrent: { type: DataTypes.INTEGER, allowNull: true },
    location: { type: DataTypes.GEOGRAPHY("POINT", 4326), allowNull: true },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "available" },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false },
  });

  await queryInterface.addIndex("workers", ["jurisdictionId", "externalId"], {
    unique: true,
    name: "workers_jurisdiction_id_external_id_unique",
  });

  await queryInterface.addIndex("workers", ["location"], {
    name: "workers_location_gist",
    using: "gist",
  });
};

export const down = async ({ context: queryInterface }: { context: QueryInterface }) => {
  await queryInterface.dropTable("workers");
};
