const express = require('express')
const app = express()
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config()
const stripe = require("stripe")(process.env.PAYMENT_SECRET_KEY);
const port = process.env.PORT || 5000
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

// middleware
app.use(cors())
app.use(express.json());


const verifyJWT = (req, res, next) => {
    const authorization = req.headers.authorization;
    if (!authorization) {
        return res.status(401).send({ error: true, message: 'unauthorized access' })
    }
    const token = authorization.split(' ')[1];

    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).send({ error: true, message: 'unauthorized access' })
        }
        req.decoded = decoded;
        next();
    })
}

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.zdzdyrx.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();

        const userCollection = client.db("swiftBite").collection("user");
        const menuCollection = client.db("swiftBite").collection("menu");
        const orderCollection = client.db("swiftBite").collection("order");
        const paymentCollection = client.db("swiftBite").collection("payment");
        //TODO: create bookingCollection for delete the item..
        

        app.post('/jwt', (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' })
            res.send({ token });
        })

        // It's a middleware checking a user is Admin or not in the database. That's why it's writting in between mongodb.
        //Warning: use verifyJWT before using verifyAdmin.
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email }
            const user = await userCollection.findOne(query);
            if (user?.role !== 'admin') {
                return res.status(403).send({ error: true, message: 'forbidden access.' })
            }
            next();
        }

        // {---------user api---------}
        app.get('/user', verifyJWT, verifyAdmin, async (req, res) => {
            const result = await userCollection.find().toArray();
            res.send(result);
        })

        app.post('/user', async (req, res) => {
            const user = req.body;
            const query = { email: user.email }
            const existingUser = await userCollection.findOne(query)
            if (existingUser) {
                return res.send({ message: 'user already exists' })
            }
            const result = await userCollection.insertOne(user);
            res.send(result);
        })

        app.get('/user-statistics/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;

            if (req.decoded.email !== email) {
                return res.status(401).send({ message: 'unauthorized access!' });
            }

            try {
                const payments = await paymentCollection.find({ email: email }).toArray();

                // Calculate item counts using Array.reduce and forEach
                const itemCounts = payments.reduce((acc, payment) => {
                    payment.itemsName.forEach(itemName => acc[itemName] = (acc[itemName] || 0) + 1);
                    return acc;
                }, {});

                // Calculate total revenue
                const totalRevenue = payments.reduce((sum, item) => sum + item.price, 0).toFixed(2);

                // Calculate total item count
                const totalItemCount = Object.values(itemCounts).reduce((sum, count) => sum + count, 0);

                // Count menu items
                const menuItemsCount = await menuCollection.countDocuments();

                res.send({
                    totalRevenue,
                    totalItemCount,
                    menuItemsCount
                });
            } catch (error) {
                console.error(error);
                res.status(500).send({ message: 'Internal Server Error' });
            }
        });


        // {---------admin api---------}
        app.get('/user/admin/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;
            if (req.decoded.email != email) {
                res.send({ admin: false })
            }

            const query = { email: email }
            const user = await userCollection.findOne(query);
            const result = { admin: user?.role === 'admin' }
            res.send(result);
        })

        app.patch('/user/admin/:id', async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) }
            const updateDoc = {
                $set: {
                    role: 'admin'
                },
            };
            const result = await userCollection.updateOne(filter, updateDoc);
            res.send(result);
        })

        app.delete('/user/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await userCollection.deleteOne(query);
            res.send(result);
        })

        // {---------menu api---------}
        app.get('/menu', async (req, res) => {
            const result = await menuCollection.find().toArray();
            res.send(result);
        })

        app.get('/menu/category/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await menuCollection.findOne(query);
            res.send(result);
        })

        app.post('/menu', verifyJWT, verifyAdmin, async (req, res) => {
            const item = req.body;
            const result = await menuCollection.insertOne(item);
            res.send(result);
        })

        app.patch('/menu/category/:id', async (req, res) => {
            const item = req.body;
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) }
            const updateDoc = {
                $set: {
                    name: item.name,
                    image: item.image,
                    price: item.price,
                    category: item.category,
                    short_description: item.short_description
                }
            }

            const result = await menuCollection.updateOne(filter, updateDoc);
            res.send(result);
        })

        app.delete('/menu/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await menuCollection.deleteOne(query);
            res.send(result);
        })

        // {---------order api---------}
        app.get('/order', verifyJWT, async (req, res) => {
            const email = req.query.email;
            if (!email) {
                res.send([]);
            }

            const decodedEmail = req.decoded.email;
            if (email != decodedEmail) {
                return res.status(403).send({ error: true, message: 'forbidden access' })
            }

            const query = { buyer_email: email };
            const result = await orderCollection.find(query).toArray();
            res.send(result);
        })

        //using aggregate pipeline
        app.get('/bookingHistory/:email',  async (req, res) => {
            const email = req.params.email;
            try {
                const result = await paymentCollection.aggregate([
                    { $match: { email } },
                    { $unwind: '$itemsName' },
                    {
                        $lookup: {
                            from: 'menu',
                            localField: 'itemsName',
                            foreignField: 'name',
                            as: 'detailedMenuItems'
                        }
                    },
                    {
                        $unwind: '$detailedMenuItems'
                    },
                ]).toArray();

                res.send(result);
            } catch (error) {
                console.error(error);
                res.status(500).send({ error: true, message: 'Internal Server Error' });
            }
        });

        app.post('/order', async (req, res) => {
            const item = req.body;
            const result = await orderCollection.insertOne(item);
            res.send(result);
        })

        app.delete('/order/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await orderCollection.deleteOne(query);
            res.send(result);
        })

        // {---------Payment api---------}
        //payment Intent
        app.post('/create-payment-intent', verifyJWT, async (req, res) => {
            const { price } = req.body;
            const amount = price * 100;

            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: "usd",
                payment_method_types: [
                    "card"
                ],
            });

            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        })

        app.get('/payment/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;
            if (req.decoded.email != email) {
                return res.status(403).send({ message: 'forbidden access' });
            }

            const query = { email: email }
            const result = await paymentCollection.find(query).toArray();
            res.send(result);
        })

        app.post('/payment', verifyJWT, async (req, res) => {
            const payment = req.body;
            const insertResult = await paymentCollection.insertOne(payment);

            const query = { _id: { $in: payment.orderItems.map(id => new ObjectId(id)) } }
            const deleteResult = await orderCollection.deleteMany(query);


            res.send({ insertResult, deleteResult });
        })

        app.get('/admin-statistics', verifyJWT, verifyAdmin, async (req, res) => {
            const user = await userCollection.estimatedDocumentCount();
            const menuItems = await menuCollection.estimatedDocumentCount();
            const orders = await orderCollection.estimatedDocumentCount();
            const payments = await paymentCollection.find().toArray();
            const revenue = payments.reduce((sum, item) => sum + item.price, 0)

            res.send({
                user,
                menuItems,
                orders,
                revenue
            });
        })

        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.log);


app.get('/', (req, res) => {
    res.send('Hello swiftBite!')
})

app.listen(port, () => {
    console.log(`your server is running on port ${port}`)
})