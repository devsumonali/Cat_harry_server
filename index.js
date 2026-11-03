import express from 'express';
import cors from 'cors';
import { MongoClient, ObjectId } from 'mongodb';
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
const categoriesCollection = db.collection('categories');
const studiosBookingCollection = db.collection('studiosBooking');

//booking api create
app.post('/api/studios/booking', async (req, res) => {
     const bookingData = req.body;
     const result = await studiosBookingCollection.insertOne(bookingData);
     res.send(result);
});

//single category api
app.get('/api/categories/:slug/studios', async (req, res) => {
     const slug = req.params.slug;
     const result = await studiosCollection.find({ category: slug }).toArray();

     res.send(result);
});

//category api
app.get('/api/categories', async (req, res) => {
     const result = await categoriesCollection.find().toArray();
     res.send(result);
});

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

// Get single studio by ID
app.get('/api/studios/:id', async (req, res) => {
     const id = req.params.id;
     const result = await studiosCollection.findOne({ _id: new ObjectId(id) });

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
