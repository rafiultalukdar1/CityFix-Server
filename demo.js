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