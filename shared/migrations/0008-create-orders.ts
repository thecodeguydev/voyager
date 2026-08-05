import { DataTypes, type QueryInterface } from "sequelize";

export const up = async ({ context: queryInterface }: { context: QueryInterface }) => {
  await queryInterface.createTable("orders", {
    id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
    jurisdictionId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "jurisdictions", key: "id" },
      onDelete: "CASCADE",
    },
    externalId: { type: DataTypes.STRING, allowNull: false },
    type: { type: DataTypes.STRING, allowNull: false },
    priorityTier: { type: DataTypes.STRING, allowNull: true },
    payload: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    pickup: { type: DataTypes.GEOGRAPHY("POINT", 4326), allowNull: false },
    state: { type: DataTypes.STRING, allowNull: false, defaultValue: "created" },
    slaDueAt: { type: DataTypes.DATE, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false },
  });

  await queryInterface.addIndex("orders", ["jurisdictionId", "externalId"], {
    unique: true,
    name: "orders_jurisdiction_id_external_id_unique",
  });

  await queryInterface.addIndex("orders", ["jurisdictionId", "state"], {
    name: "orders_jurisdiction_id_state",
  });

  await queryInterface.addIndex("orders", ["slaDueAt"], {
    name: "orders_sla_due_at",
  });

  await queryInterface.addIndex("orders", ["pickup"], {
    name: "orders_pickup_gist",
    using: "gist",
  });
};

export const down = async ({ context: queryInterface }: { context: QueryInterface }) => {
  await queryInterface.dropTable("orders");
};
