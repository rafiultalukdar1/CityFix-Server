require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const app = express();
const stripe = require('stripe')(process.env.STRIPE_SECRET);
const port = process.env.PORT || 3000;

// middle-ware
app.use(cors());
app.use(express.json());


const admin = require("firebase-admin");

// const serviceAccount = require("./city-fix-firebase-adminsdk.json");
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8')
const serviceAccount = JSON.parse(decoded);

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
        // await client.connect();

        const db = client.db('city_fix_db');
        const issuesCollection = db.collection('issues');
        const usersCollection = db.collection('users');
        const paymentCollection = db.collection('payments');


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
        };


        // block
        const verifyNotBlocked = async (req, res, next) => {
            const email = req.decoded_email
            const user = await usersCollection.findOne({ email })
            if (user?.isBlocked) {
                return res.status(403).send({ message: 'Your account is blocked' })
            }
            next()
        };


        // POST: API
        app.post('/issues', async (req, res) => {
            const issue = req.body;
            const { submittedBy } = issue;
            const user = await usersCollection.findOne({ email: submittedBy });
            if (!user) {
                return res.status(404).send({ message: "User not found" });
            }
            if (user.isBlocked) {
                return res.status(403).send({
                message: 'Your account is blocked. You cannot report issues.'
                });
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


        // GET: Save User with latestPayment
        app.get('/users', verifyFBToken, async (req, res) => {
            const email = req.decoded_email;
            const user = await usersCollection.findOne({ email });
            if (!user) {
                return res.status(404).send({ message: "User not found" });
            }
            const latestPayment = await paymentCollection
                .find({ userEmail: email })
                .sort({ paidAt: -1 })
                .limit(1)
                .toArray();
            res.send({
                ...user,
                latestPayment: latestPayment[0] || null
            });
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
        app.patch('/issues/:id', verifyFBToken, verifyNotBlocked, async (req, res) => {
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
        app.delete('/issues/:id', verifyFBToken, verifyNotBlocked, async (req, res) => {
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
        });


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


        // Assigned Issues
        app.patch('/issues/:id/status', verifyFBToken, verifyStaff, async (req, res) => {
            const id = req.params.id
            const { status } = req.body
            const email = req.decoded_email
            const issue = await issuesCollection.findOne({ _id: new ObjectId(id) })
            if (!issue) return res.status(404).send({ message: 'Issue not found' })
            if (issue.assignedStaff?.email !== email) {
                return res.status(403).send({ message: 'Forbidden' })
            }
            const allowedStatus = ['in-progress', 'working', 'resolved', 'closed']
            if (!allowedStatus.includes(status)) {
                return res.status(400).send({ message: 'Invalid status change' })
            }
            const staffName = issue.assignedStaff?.name || 'Staff'
            const result = await issuesCollection.updateOne(
                { _id: new ObjectId(id) },
                {
                    $set: {
                        status,
                        updatedAt: new Date()
                    },
                    $push: {
                        timeline: {
                            status,
                            message: `Status changed to ${status}`,
                            updatedBy: {
                                name: staffName,
                                email,
                                role: 'staff'
                            },
                            timestamp: new Date()
                        }
                    }
                }
            )
            res.send(result)
        });


        // All issue for admin
        app.get('/admin-all-issues', verifyFBToken, verifyAdmin, async (req, res) => {
            const issues = await issuesCollection.find({}).toArray()
            res.send(issues)
        });


        // GET: All users (admin only)
        app.get('/admin-all-users', verifyFBToken, verifyAdmin, async (req, res) => {
            const users = await usersCollection.find({}).toArray();
            res.send(users);
        });


        // show user in admin dashboard
        app.get('/admin-citizens', verifyFBToken, verifyAdmin, async (req, res) => {
            const users = await usersCollection.find({ role: 'citizen' }).toArray();
            res.send(users);
        });


        // block user by admin
        app.patch('/users-block/:id', verifyFBToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const user = await usersCollection.findOne({ _id: new ObjectId(id) });
            if (!user) return res.status(404).send({ message: 'User not found' });
            await usersCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: { isBlocked: !user.isBlocked } }
            );
            res.send({ success: true });
        });


        // Manage staff
        app.get('/users-staff', verifyFBToken, verifyAdmin, async (req, res) => {
            const staffs = await usersCollection
                .find({ role: 'staff' })
                .sort({ createdAt: -1 })
                .toArray();
            res.send(staffs);
        });


        // Staf create
        app.post('/users-staff', verifyFBToken, verifyAdmin, async (req, res) => {
            try {
                const { name, email, phone, password, photo } = req.body;
                if (!name || !email || !phone || !password || !photo) {
                    return res.status(400).send({ message: 'All fields are required' });
                }
                let firebaseUser;
                try {
                    firebaseUser = await admin.auth().createUser({
                        email: email.trim(),
                        password: password,
                        displayName: name.trim(),
                        photoURL: photo
                    });
                } catch (err) {
                    if (err.code === 'auth/email-already-exists') {
                        return res.status(400).send({ message: 'Email already exists' });
                    }
                    return res.status(500).send({ message: 'Firebase error', error: err.message });
                }
                const staffUser = {
                    uid: firebaseUser.uid,
                    name: name.trim(),
                    email: email.trim(),
                    phone: phone.trim(),
                    photo: photo,
                    role: 'staff',
                    isBlocked: false,
                    createdAt: new Date()
                };
                const result = await usersCollection.insertOne(staffUser);
                res.status(201).send({ success: true, insertedId: result.insertedId });
            } catch (error) {
                res.status(500).send({ message: 'Internal server error', error: error.message });
            }
        });


        // PUT: Update a staff
        app.put('/users-staff/:id', verifyFBToken, verifyAdmin, async (req, res) => {
            try {
                const staffId = req.params.id;
                const { name, phone, photo } = req.body;
                const updateDoc = { name, phone, photo };
                const result = await usersCollection.updateOne(
                    { _id: new ObjectId(staffId), role: 'staff' },
                    { $set: updateDoc }
                );
                if (result.matchedCount === 0) {
                    return res.status(404).send({ message: 'Staff not found' });
                }
                res.send({ success: true, message: 'Staff updated successfully' });
            } catch (err) {
                console.error(err);
                res.status(500).send({ message: 'Failed to update staff' });
            }
        });


        // DELETE: Remove a staff
        app.delete('/users-staff/:id', verifyFBToken, verifyAdmin, async (req, res) => {
            try {
                const staffId = req.params.id;
                const result = await usersCollection.deleteOne({
                    _id: new ObjectId(staffId),
                    role: 'staff'
                });
                if (result.deletedCount === 0) {
                    return res.status(404).send({ success: false, message: 'Staff not found' });
                }
                res.send({ success: true, message: 'Staff deleted successfully' });
            } catch (err) {
                console.error(err);
                res.status(500).send({ success: false, message: 'Failed to delete staff' });
            }
        });


        // STRIPE: Payment
        app.post('/create-checkout-session', async (req, res) => {
            try {
                const { email } = req.body;
                if (!email) {
                    return res.status(400).send({ message: "Email is required" });
                }
                const amount = 7.87;
                const session = await stripe.checkout.sessions.create({
                    payment_method_types: ['card'],
                    mode: 'payment',
                    customer_email: email,
                    line_items: [
                        {
                            price_data: {
                                currency: 'usd',
                                product_data: {
                                    name: 'CityFix Premium Subscription',
                                },
                                unit_amount: Math.round(amount * 100),
                            },
                            quantity: 1,
                        },
                    ],
                    success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
                    cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancel`,
                    metadata: {
                        plan: 'premium',
                        userEmail: email
                    }
                });
                res.send({ url: session.url });
            } catch (error) {
                console.error(error);
                res.status(500).send({
                    message: "Stripe checkout session creation failed",
                    error: error.message,
                });
            }
        });


        // Success endpoint
        app.post('/payment-success', verifyFBToken, async (req, res) => {
            try {
                const { stripeSessionId } = req.body;
                if (!stripeSessionId) {
                    return res.status(400).send({ success: false, message: "Session ID required" });
                }
                const existingPayment = await paymentCollection.findOne({ stripeSessionId });
                if (existingPayment) {
                    return res.send({
                        success: true,
                        message: "Payment already processed",
                        paymentRecord: existingPayment
                    });
                }
                const session = await stripe.checkout.sessions.retrieve(stripeSessionId, {
                    expand: ['payment_intent']
                });
                if (session.payment_status !== 'paid') {
                    return res.status(400).send({ success: false, message: "Payment not completed" });
                }
                const amount = session.amount_total / 100;
                const currency = session.currency;
                const transactionId = session.payment_intent.id;
                const customerEmail = session.customer_email;
                await usersCollection.updateOne(
                    { email: customerEmail },
                    { $set: { isPremium: true } }
                );
                const paymentRecord = {
                    userEmail: customerEmail,
                    type: "Premium Subscription",
                    amount,
                    currency,
                    transactionId,
                    stripeSessionId,
                    payment_status: "paid",
                    paidAt: new Date()
                };
                await paymentCollection.insertOne(paymentRecord);
                res.send({
                    success: true,
                    message: "Payment verified & subscription upgraded!",
                    paymentRecord
                });
            } catch (err) {
                console.error(err);
                res.status(500).send({
                    success: false,
                    message: "Payment verification failed",
                    error: err.message
                });
            }
        });


        // Get all payments of logged-in user
        app.get('/my-payments', verifyFBToken, async (req, res) => {
            try {
                const email = req.decoded_email;
                const payments = await paymentCollection
                    .find({ userEmail: email })
                    .sort({ paidAt: -1 })
                    .toArray();
                res.send(payments);
            } catch (err) {
                console.error(err);
                res.status(500).send({ message: "Failed to fetch payments", error: err.message });
            }
        });


        // Boost Payment
        app.post('/create-boost-session/:issueId', async (req, res) => {
            try {
                const { email } = req.body;
                const { issueId } = req.params;
                if (!email || !issueId) {
                    return res.status(400).send({ message: "Email and Issue ID are required" });
                }
                const amountUSD = 1;
                const session = await stripe.checkout.sessions.create({
                    payment_method_types: ['card'],
                    mode: 'payment',
                    customer_email: email,
                    line_items: [
                        {
                            price_data: {
                                currency: 'usd',
                                product_data: { name: 'Boost Issue' },
                                unit_amount: Math.round(amountUSD * 100),
                            },
                            quantity: 1,
                        },
                    ],
                    success_url: `${process.env.SITE_DOMAIN}/dashboard/boost-success?issueId=${issueId}&session_id={CHECKOUT_SESSION_ID}`,
                    cancel_url: `${process.env.SITE_DOMAIN}/dashboard/boost-cancel`,
                    metadata: {
                        issueId,
                        userEmail: email
                    }
                });
                res.send({ url: session.url });
            } catch (error) {
                console.error(error);
                res.status(500).send({
                    message: "Stripe boost session creation failed",
                    error: error.message,
                });
            }
        });


        // boost-issue by id
        app.post('/boost-issue/:id', verifyFBToken, verifyNotBlocked, async (req, res) => {
            const issueId = req.params.id;
            const email = req.decoded_email;
            const issue = await issuesCollection.findOne({ _id: new ObjectId(issueId) });
            if (!issue) return res.status(404).send({ message: 'Issue not found' });
            if (issue.submittedBy !== email) return res.status(403).send({ message: 'Forbidden' });
            const session = await stripe.checkout.sessions.create({
                payment_method_types: ['card'],
                mode: 'payment',
                customer_email: email,
                line_items: [
                    {
                        price_data: {
                            currency: 'usd',
                            product_data: { name: 'Boost Issue' },
                            unit_amount: 80,
                        },
                        quantity: 1,
                    }
                ],
                success_url: `${process.env.SITE_DOMAIN}/dashboard/boost-success?issueId=${issueId}&session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${process.env.SITE_DOMAIN}/dashboard/boost-cancel`,
                metadata: { issueId, userEmail: email }
            });
            res.send({ url: session.url });
        });


        // Boost success
        app.post('/boost-success', verifyFBToken, async (req, res) => {
            try {
                const { stripeSessionId } = req.body;
                if (!stripeSessionId) return res.status(400).send({ message: 'Session ID required' });
                const session = await stripe.checkout.sessions.retrieve(stripeSessionId, {
                    expand: ['payment_intent']
                });
                if (session.payment_status !== 'paid') 
                    return res.status(400).send({ message: 'Payment not completed' });
                const issueId = session.metadata.issueId;
                await issuesCollection.updateOne(
                    { _id: new ObjectId(issueId) },
                    { $set: { isBoosted: true } }
                );
                const transactionId = session.payment_intent?.id || session.payment_intent;
                const paymentRecord = {
                    transactionId,
                    userEmail: session.metadata.userEmail || null,
                    type: "Boost Payment",
                    amount: session.amount_total / 100,
                    currency: session.currency,
                    stripeSessionId,
                    issueId,
                    payment_status: 'paid',
                    paidAt: new Date(session.created * 1000)
                };
                await paymentCollection.insertOne(paymentRecord);
                res.send({
                    success: true,
                    message: 'Issue boosted successfully',
                    paymentRecord
                });
            } catch (err) {
                console.error(err);
                res.status(500).send({ message: 'Boost success failed', error: err.message });
            }
        });



        app.get('/admin-all-payments', verifyFBToken, verifyAdmin, async (req, res) => {
            try {
                const { type, status } = req.query;
                const query = {};
                if (type) query.type = type;
                if (status) query.payment_status = status;
                const payments = await paymentCollection
                    .find(query)
                    .sort({ paidAt: -1 })
                    .toArray();

                res.send(payments);
            } catch (err) {
                console.error(err);
                res.status(500).send({ message: 'Failed to fetch payments' });
            }
        });


        // await client.db("admin").command({ ping: 1 });
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