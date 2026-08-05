import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from "sequelize";
import { baseColumns, isInValidator } from "./base.js";

export type ScheduleType = "shift" | "timeoff";
const SCHEDULE_TYPES: readonly ScheduleType[] = ["shift", "timeoff"];

export class Schedule extends Model<InferAttributes<Schedule>, InferCreationAttributes<Schedule>> {
  declare id: CreationOptional<string>;
  declare workerId: string;
  declare dayOfWeek: number | null;
  declare date: string | null;
  declare startTime: string;
  declare endTime: string;
  declare type: ScheduleType;
  declare recurring: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

export function initScheduleModel(sequelize: Sequelize): typeof Schedule {
  Schedule.init({
    ...baseColumns(),
    "workerId": {
      "type": DataTypes.UUID,
      "allowNull": false
    },
    "dayOfWeek": {
      "type": DataTypes.INTEGER,
      "allowNull": true
    },
    "date": {
      "type": DataTypes.DATEONLY,
      "allowNull": true
    },
    "startTime": {
      "type": DataTypes.TIME,
      "allowNull": false
    },
    "endTime": {
      "type": DataTypes.TIME,
      "allowNull": false
    },
    "type": {
      "type": DataTypes.STRING,
      "allowNull": false,
      "validate": isInValidator(SCHEDULE_TYPES)
    },
    "recurring": {
      "type": DataTypes.BOOLEAN,
      "allowNull": false,
      "defaultValue": false
    },
  }, { 
    sequelize, 
    "tableName": "schedules", 
    "modelName": "Schedule" 
  });
  
  return Schedule;
}
