const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
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
            const result = await issuesCollection.insertOne(issue);
            res.send(result);
        });

        // issue get api
        app.get('/issues', async (req, res) => {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 9;
        const skip = (page - 1) * limit;
        const search = req.query.search || '';
        const status = req.query.status;
        const priority = req.query.priority;
        const category = req.query.category;
        const query = {};
        if (search) {
            query.$or = [
                { title: { $regex: search, $options: 'i' } },
                { category: { $regex: search, $options: 'i' } },
                { location: { $regex: search, $options: 'i' } }
            ];
        }
        if (status) {
            query.status = status;
        }
        if (priority) {
            query.isBoosted = priority.toLowerCase() === 'high' ? true : false;
        }
        if (category) {
            query.category = { $regex: category, $options: 'i' }; // <-- fixed
        }
        const total = await issuesCollection.countDocuments(query);
        const totalPages = Math.ceil(total / limit);
        const issues = await issuesCollection
            .find(query)
            .sort({ isBoosted: -1, priority: -1, upvotes: -1, createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .toArray();
        res.send({ issues, totalPages });
    });




        // app.get('/issues', async (req, res) => {
        //     const page = parseInt(req.query.page) || 1;
        //     const limit = parseInt(req.query.limit) || 9;
        //     const skip = (page - 1) * limit;
        //     const total = await issuesCollection.countDocuments();
        //     const totalPages = Math.ceil(total / limit);
        //     const issues = await issuesCollection
        //         .find({})
        //         .sort({ isBoosted: -1, priority: -1, upvotes: -1, createdAt: -1 }) // sorting
        //         .skip(skip)
        //         .limit(limit)
        //         .toArray();
        //     res.send({ issues, totalPages });
        // });





        // Recently Resolved Api
        app.get('/recent-resolved-issues', async (req, res) =>{
            const cursor = issuesCollection
                .find({ status: "resolved" })
                .sort({ createdAt: -1 })
                .limit(6);
            const result = await cursor.toArray();
            res.send(result);
        });

        // Toggle Upvote API
        app.patch('/issues/upvote/:id', async (req, res) => {
            const issueId = req.params.id;
            const { userEmail } = req.body;
            const issue = await issuesCollection.findOne({ _id: new ObjectId(issueId) });
            if (!issue) return res.status(404).send({ message: "Issue not found" });
            const hasLiked = issue.upvotedUsers?.includes(userEmail);
            let updateDoc;
            if (hasLiked) {
                updateDoc = {
                    $inc: { upvotes: -1 },
                    $pull: { upvotedUsers: userEmail }
                };
            } else {
                updateDoc = {
                    $inc: { upvotes: 1 },
                    $push: { upvotedUsers: userEmail }
                };
            }
            const result = await issuesCollection.updateOne(
                { _id: new ObjectId(issueId) },
                updateDoc
            );
            res.send({ updated: true, liked: !hasLiked });
        });

        // Get single issue by ID
        app.get('/issues/:id', async (req, res) => {
            const id = req.params.id;
            const issue = await issuesCollection.findOne({ _id: new ObjectId(id) });
            res.send(issue);
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