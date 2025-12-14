


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