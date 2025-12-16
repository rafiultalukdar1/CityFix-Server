const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const app = express();
const port = process.env.PORT || 3000;
require('dotenv').config();

// middle-ware
app.use(cors());
app.use(express.json());


const admin = require("firebase-admin");
const serviceAccount = require("./city-fix-firebase-adminsdk.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});


const verifyFBToken = async (req, res, next) => {
    const token = req.headers.authorization;
    if (!token) {
        return res.status(401).send({ message: 'Unauthorized access!' });
    }
    try {
        const idToken = token.split(' ')[1];
        const decoded = await admin.auth().verifyIdToken(idToken);
        req.decoded_email = decoded.email;
        next();
    } catch (err) {
        return res.status(401).send({ message: 'Unauthorized access!' });
    }
};







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
        const usersCollection = db.collection('users');

        // Admin Verify Middle-Ware
        const verifyAdmin = async (req, res, next) => {
        const email = req.decoded_email;
        const user = await usersCollection.findOne({ email });
        if (!user || user.role !== 'admin') {
            return res.status(403).send({ message: 'Admin only access' });
        }
            next();
        };

        // Staff Verify Middle-Ware
        const verifyStaff = async (req, res, next) => {
            const email = req.decoded_email
            const user = await usersCollection.findOne({ email })
            if (!user || user.role !== 'staff') {
                return res.status(403).send({ message: 'Staff only access' })
            }
            next()
        }



        // POST: API
        app.post('/issues', async (req, res) => {
            const issue = req.body;
            const { submittedBy } = issue;
            const user = await usersCollection.findOne({ email: submittedBy });
            if (!user) {
                return res.status(404).send({ message: "User not found" });
            }
            if (!user.isPremium) {
                const userIssuesCount = await issuesCollection.countDocuments({ submittedBy });
                if (userIssuesCount >= 3) {
                    return res.status(403).send({
                        message: "Free users can submit only 3 issues. Please subscribe for unlimited reporting."
                    });
                }
            }
            const result = await issuesCollection.insertOne(issue);
            res.send(result);
        });

        

        // issue get api
        app.get('/issues', async (req, res) => {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 9;
            const skip = (page - 1) * limit;
            const { search = '', status, priority, category, submittedBy } = req.query;
            const query = {};
            if (search) {
                query.$or = [
                    { title: { $regex: search, $options: 'i' } },
                    { category: { $regex: search, $options: 'i' } },
                    { location: { $regex: search, $options: 'i' } }
                ];
            }
            if (status) query.status = status;
            if (priority) query.isBoosted = priority.toLowerCase() === 'high';
            if (category) query.category = { $regex: category, $options: 'i' };
            if (submittedBy) query.submittedBy = submittedBy;
            const total = await issuesCollection.countDocuments(query);
            const totalPages = Math.ceil(total / limit);
            const issues = await issuesCollection
                .find(query)
                .sort({ isBoosted: -1, priority: -1, upvotes: -1, createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .toArray();
            res.send({ issues, totalPages, total });
        });


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


        // POST: Save User
        app.post("/users", async (req, res) => {
            const user = req.body;
            const existing = await usersCollection.findOne({ email: user.email });
            if (existing) {
                return res.send({ message: "User already exists" });
            }
            const result = await usersCollection.insertOne(user);
            res.send(result);
        });

        // GET: Save User
        app.get('/users', verifyFBToken, async (req, res) => {
            const email = req.decoded_email;
            const user = await usersCollection.findOne({ email });
            if (!user) {
                return res.status(404).send({ message: "User not found" });
            }
            res.send(user);
        });

        // PUT: Update User
        app.put('/users/:email', async (req, res) => {
            const email = req.params.email;
            const updateData = req.body;
            const result = await usersCollection.updateOne(
                { email },
                { $set: updateData }
            );
            res.send(result);
        });

        // My issue
        app.get('/my-issues', verifyFBToken, async (req, res) => {
            const email = req.decoded_email;
            const { status, category } = req.query;
            const query = { submittedBy: email };
            if (status) query.status = status;
            if (category) query.category = category;
            const issues = await issuesCollection
                .find(query)
                .sort({ createdAt: -1 })
                .toArray();
            res.send(issues);
        });

        // PATCH: Update Issue
        app.patch('/issues/:id', verifyFBToken, async (req, res) => {
            const id = req.params.id;
            const email = req.decoded_email;
            const updateData = req.body;
            const issue = await issuesCollection.findOne({ _id: new ObjectId(id) });
            if (!issue) {
                return res.status(404).send({ message: 'Issue not found' });
            }
            if (issue.submittedBy !== email) {
                return res.status(403).send({ message: 'Forbidden access' });
            }
            if (updateData.images && typeof updateData.images === 'string') {
                updateData.images = [updateData.images];
            }
            const result = await issuesCollection.updateOne(
                { _id: new ObjectId(id) },
                {
                    $set: {
                        ...updateData,
                        updatedAt: new Date()
                    }
                }
            );
            res.send(result);
        });

        // DELETE: Delete Issue
        app.delete('/issues/:id', verifyFBToken, async (req, res) => {
            const id = req.params.id;
            const email = req.decoded_email;
            const issue = await issuesCollection.findOne({ _id: new ObjectId(id) });
            if (!issue) {
                return res.status(404).send({ message: 'Issue not found' });
            }
            if (issue.submittedBy !== email) {
                return res.status(403).send({ message: 'Forbidden access' });
            }
            const result = await issuesCollection.deleteOne({ _id: new ObjectId(id) });
            res.send(result);
        });



        // New
        app.patch('/issues/:id/assign-staff', verifyFBToken, verifyAdmin, async (req, res) => {
            const issueId = req.params.id
            const { staffId } = req.body
            const issue = await issuesCollection.findOne({ _id: new ObjectId(issueId) })
            if (!issue) return res.status(404).send({ message: 'Issue not found' })
            if (issue.assignedStaff) {
                return res.status(400).send({ message: 'Staff already assigned' })
            }
            const staff = await usersCollection.findOne({
                _id: new ObjectId(staffId),
                role: 'staff'
            })
            if (!staff) return res.status(404).send({ message: 'Staff not found' })
            const assignedStaff = {
                id: staff._id,
                name: staff.name,
                email: staff.email
            }
            const result = await issuesCollection.updateOne(
                { _id: new ObjectId(issueId) },
                {
                    $set: { assignedStaff },
                    $push: {
                        timeline: {
                            status: 'pending',
                            message: `Issue assigned to ${staff.name}`,
                            updatedBy: { name: 'Admin', role: 'admin' },
                            timestamp: new Date()
                        }
                    }
                }
            )
            res.send(result)
        })

        // server/routes/users.js
        app.get('/users/staff', verifyFBToken, verifyAdmin, async (req, res) => {
            const staffs = await usersCollection.find({ role: 'staff' }).toArray();
            res.send(staffs);
        });


        // Assigned Issues
        app.get('/assigned-issues', verifyFBToken, verifyStaff, async (req, res) => {
            const email = req.decoded_email
            const issues = await issuesCollection
                .find({ 'assignedStaff.email': email })
                .sort({ createdAt: -1 })
                .toArray()
            res.send(issues)
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