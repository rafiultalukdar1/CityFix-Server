const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion } = require('mongodb');
const app = express();
const port = process.env.PORT || 3000;
require('dotenv').config();

// middle-ware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.BD_USER}:${process.env.DB_PASS}@cluster0.w0v9pwr.mongodb.net/?appName=Cluster0`;

// MongoClient
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
    try{
        await client.connect();

        const db = client.db('city_fix_db');
        const issuesCollection = db.collection('issues');



        // api
        app.post('/issues', async (req, res) => {
            const issue = req.body;
            issue.createdAt = new Date();
            const result = await issuesCollection.insertOne(issue);
            res.send(result);
        });












        

        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    }
    finally{

    }
}

run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('Server is running!')
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});