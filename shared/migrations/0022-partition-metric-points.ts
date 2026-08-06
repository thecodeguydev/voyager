import { DataTypes, type QueryInterface } from "sequelize";

const MONTHS_AHEAD = 3;

/** "metric_points_2026_08" — duplicated from shared/src/telemetry/partitionMaintenance.ts's
 * naming convention since migrations can't import shared/src (see 0019's note on Umzug's loader). */
function partitionName(year: number, month: number): string {
  return `metric_points_${year}_${String(month).padStart(2, "0")}`;
}

function monthBounds(year: number, month: number): { from: Date; to: Date } {
  return { from: new Date(Date.UTC(year, month - 1, 1)), to: new Date(Date.UTC(year, month, 1)) };
}

// Converts metric_points (a plain table since migration 0018, with no rows in any real
// environment) into a natively partitioned table by ts — see PLAN.md "Partitioning". Drop and
// recreate is safe here specifically because there's no data anywhere to preserve.
//
// Postgres requires a partitioned table's primary key to include the partition key column, so
// the PK becomes composite (id, ts) instead of a plain id — a departure from every other table in
// this schema, accepted because MetricPoint is insert-only and never looked up by id alone.
//
// Pre-creates the current month + MONTHS_AHEAD future partitions plus a DEFAULT catch-all, so no
// telemetry write ever 500s waiting on the engine scheduler's first ensureFuturePartitions() tick.
export const up = async ({ context: queryInterface }: { context: QueryInterface }) => {
  const sequelize = queryInterface.sequelize;

  await sequelize.query("DROP TABLE IF EXISTS metric_points");

  await sequelize.query(`
    CREATE TABLE metric_points (
      id uuid NOT NULL,
      "metricKey" varchar(255) NOT NULL,
      "jurisdictionId" uuid NOT NULL REFERENCES jurisdictions(id) ON DELETE CASCADE,
      "workerId" uuid REFERENCES workers(id) ON DELETE CASCADE,
      "orderId" uuid REFERENCES orders(id) ON DELETE CASCADE,
      value decimal NOT NULL,
      dimensions jsonb NOT NULL DEFAULT '{}',
      ts timestamptz NOT NULL DEFAULT now(),
      "createdAt" timestamptz NOT NULL,
      "updatedAt" timestamptz NOT NULL,
      PRIMARY KEY (id, ts)
    ) PARTITION BY RANGE (ts)
  `);

  await sequelize.query(
    `CREATE INDEX metric_points_key_jurisdiction_ts ON metric_points ("metricKey", "jurisdictionId", ts)`,
  );

  await sequelize.query("CREATE TABLE metric_points_default PARTITION OF metric_points DEFAULT");

  const now = new Date();
  for (let i = 0; i <= MONTHS_AHEAD; i++) {
    const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
    const year = target.getUTCFullYear();
    const month = target.getUTCMonth() + 1;
    const name = partitionName(year, month);
    const { from, to } = monthBounds(year, month);
    await sequelize.query(
      `CREATE TABLE "${name}" PARTITION OF metric_points FOR VALUES FROM (:from) TO (:to)`,
      { replacements: { from, to } },
    );
  }
};

export const down = async ({ context: queryInterface }: { context: QueryInterface }) => {
  await queryInterface.sequelize.query("DROP TABLE IF EXISTS metric_points");

  await queryInterface.createTable("metric_points", {
    id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
    metricKey: { type: DataTypes.STRING, allowNull: false },
    jurisdictionId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "jurisdictions", key: "id" },
      onDelete: "CASCADE",
    },
    workerId: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: "workers", key: "id" },
      onDelete: "CASCADE",
    },
    orderId: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: "orders", key: "id" },
      onDelete: "CASCADE",
    },
    value: { type: DataTypes.DECIMAL, allowNull: false },
    dimensions: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    ts: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false },
  });

  await queryInterface.addIndex("metric_points", ["metricKey", "jurisdictionId", "ts"], {
    name: "metric_points_key_jurisdiction_ts",
  });
};
