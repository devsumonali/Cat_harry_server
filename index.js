import express from 'express';
import cors from 'cors';
import { MongoClient } from 'mongodb';
import 'dotenv/config';

// express import
const app = express();

//basic port
const PORT = 8000;

//middleware add
app.use(cors());
app.use(express.json());

//connect mongodb server

const client = new MongoClient(process.env.MONGODB_URI);
export async function connectToMongoDB() {
     try {
          await client.connect();
          console.log('You successfully connected to MongoDB!');
          return client;
     } catch (err) {
          console.dir(err);
     }
}

const connectClient = await connectToMongoDB();
const db = connectClient.db('studiospace_db');
const studiosCollection = db.collection('studios');
// const categoriesCollection = db.collection('categories');

//studios data post
app.post('/api/studios', async (req, res) => {
     //step 1
     const studiosData = req.body;
     //step 2 insert data in mongodb
     const result = await studiosCollection.insertOne(studiosData);
     res.send(result);
});

//studios data get
app.get('/api/studios', async (req, res) => {
     const result = await studiosCollection.find().toArray();
     res.send(result);
});
//data post
app.post('/api/studios', async (req, res) => {
     const studiosData = req.body;
     const result = await studiosCollection.insertOne(studiosData);
     res.send(result);
});

//create api
app.get('/api/studios', async (req, res) => {
     const result = await studiosCollection.find().toArray();
     res.send(result);
});

//server basic configuration
app.get('/', (req, res) => {
     res.send('server is running');
});

//server basic configuration
app.listen(PORT, () => {
     console.log(`server is running port ${PORT}`);
});
