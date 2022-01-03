import { EntitySchema } from 'typeorm';
// eslint-disable-next-line import/no-cycle
import { Connection } from './Connection';

export interface Api {
  id: string;
  data: string;
  connection?: Connection;
}

export const ApiEntity = new EntitySchema<Api>({
  name: 'api',
  columns: {
    id: {
      type: String,
      primary: true,
      nullable: false,
    },
    data: {
      type: 'simple-json',
      nullable: false,
    },
  },
  relations: {
    connection: {
      type: 'many-to-one',
      target: 'connection',
      inverseSide: 'connection.apis',
    },
  },
});