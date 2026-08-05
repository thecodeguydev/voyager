import type { QueryInterface } from "sequelize";

export const up = async ({ context: queryInterface }: { context: QueryInterface }) => {
  await queryInterface.sequelize.query('CREATE EXTENSION IF NOT EXISTS postgis');
};

export const down = async ({ context: queryInterface }: { context: QueryInterface }) => {
  await queryInterface.sequelize.query('DROP EXTENSION IF EXISTS postgis');
};
