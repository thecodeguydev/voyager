import type { QueryInterface } from "sequelize";

// See PLAN.md "Queue notification mechanism" — fires pg_notify('dispatch_new', jurisdictionId)
// in the same transaction as the insert, so no enqueue can happen without notifying.
export const up = async ({ context: queryInterface }: { context: QueryInterface }) => {
  await queryInterface.sequelize.query(`
    CREATE FUNCTION notify_dispatch() RETURNS trigger AS $$
    BEGIN
      PERFORM pg_notify('dispatch_new', NEW."jurisdictionId"::text);
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await queryInterface.sequelize.query(`
    CREATE TRIGGER dispatch_queue_notify
      AFTER INSERT ON dispatch_queue
      FOR EACH ROW EXECUTE FUNCTION notify_dispatch();
  `);
};

export const down = async ({ context: queryInterface }: { context: QueryInterface }) => {
  await queryInterface.sequelize.query('DROP TRIGGER IF EXISTS dispatch_queue_notify ON dispatch_queue');
  await queryInterface.sequelize.query('DROP FUNCTION IF EXISTS notify_dispatch');
};
