import express from 'express';
import cors from 'cors';

// express import
const app = express();

//basic port
const PORT = 8000;

//middleware add
app.use(cors());
app.use(express.json());

//server basic configuration
app.get('/', (req, res) => {
     res.send('server is running');
});

//server basic configuration
app.listen(PORT, () => {
     console.log(`server is running port ${PORT}`);
});
