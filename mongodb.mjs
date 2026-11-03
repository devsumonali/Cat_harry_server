import 'dotenv/config';
import { MongoClient } from 'mongodb';

export const client = new MongoClient(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017', {
     serverSelectionTimeoutMS: 10000,
});
export const db = client.db(process.env.MONGODB_DB_NAME || 'studiospace_db');
