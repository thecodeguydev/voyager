import type { Sequelize } from "sequelize";
import { Group, initGroupModel } from "./Group.js";
import { Jurisdiction, initJurisdictionModel } from "./Jurisdiction.js";
import { Zone, initZoneModel } from "./Zone.js";
import { Worker, initWorkerModel } from "./Worker.js";
import { ZoneWorker, initZoneWorkerModel } from "./ZoneWorker.js";
import { Schedule, initScheduleModel } from "./Schedule.js";
import { Order, initOrderModel } from "./Order.js";
import { DispatchQueue, initDispatchQueueModel } from "./DispatchQueue.js";

export * from "./geo.js";
export * from "./Group.js";
export * from "./Jurisdiction.js";
export * from "./Zone.js";
export * from "./Worker.js";
export * from "./ZoneWorker.js";
export * from "./Schedule.js";
export * from "./Order.js";
export * from "./DispatchQueue.js";

const initializedSequelizes = new WeakSet<Sequelize>();

/**
 * Initializes every model against `sequelize` and wires up associations. One source of
 * truth for api + engine. Idempotent per sequelize instance so callers (the app, the seed
 * loader, tests) can each call it without redefining associations twice.
 */
export function initModels(sequelize: Sequelize) {
  if (initializedSequelizes.has(sequelize)) {
    return { Group, Jurisdiction, Zone, Worker, ZoneWorker, Schedule, Order, DispatchQueue };
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

  return { Group, Jurisdiction, Zone, Worker, ZoneWorker, Schedule, Order, DispatchQueue };
}

export type Models = ReturnType<typeof initModels>;
