var mongodb = require("mongodb");

var Server = mongodb.Server,
    MongoClient = mongodb.MongoClient,
    BSON = mongodb.BSONPure;

var mongoClient = new MongoClient(new Server("localhost", 27017));

mongoClient.connect("mongodb://localhost:27017/itemsdb", function(err, db){
    if(!err){
        console.log("Connected to 'itemsdb' database");
        db.collection("items", {strict: true}, function(err, collection){
            if(err){
                console.log("The 'items' collection doesn't exist. Creating it with sample data...");
                populateDB(db);
            }else{
                db.close();
            }
        });
    }
});

exports.get = function(req, res){
    var id = req.params.id;
    console.log("Retrieving item: " + id);
    mongoClient.connect("mongodb://localhost:27017/itemsdb", function(err, db){
        db.collection("items", function(err, collection){
            collection.findOne({"_id": new BSON.ObjectID(id)}, function(err, item){
                res.send(item);
                db.close();
            });
        });
    });
};

exports.fetch = function(req, res){
    mongoClient.connect("mongodb://localhost:27017/itemsdb", function(err, db){
        db.collection("items", function(err, collection){
            collection.find().toArray(function(err, items){
                res.send(items);
                db.close();
            });
        });
    });
};

exports.add = function(req, res){
    var item = req.body;
    console.log("Adding item: " + JSON.stringify(item));
    mongoClient.connect("mongodb://localhost:27017/itemsdb", function(err, db){
        db.collection("items", function(err, collection){
            collection.insert(item, {safe: true}, function(err, result){
                if(err){
                    res.send({"error": "An error has occurred"});
                }else{
                    console.log("Success: " + JSON.stringify(result[0]));
                    res.send(result[0]);
                }
                db.close();
            });
        });
    });
}

exports.put = function(req, res){
    var id = req.params.id;
    var item = req.body;
    console.log("Updating item: " + id);
    console.log(JSON.stringify(item));
    mongoClient.connect("mongodb://localhost:27017/itemsdb", function(err, db){
        db.collection("items", function(err, collection){
            collection.update({"_id": new BSON.ObjectID(id)}, item, {safe: true}, function(err, result){
                if(err){
                    console.log("Error updating item: " + err);
                    res.send({"error": "An error has occurred"});
                }else{
                    console.log("" + result + " document(s) updated");
                    res.send(item);
                }
                db.close();
            });
        });
    });
}

exports.remove = function(req, res){
    var id = req.params.id;
    console.log("Deleting item: " + id);
    mongoClient.connect("mongodb://localhost:27017/itemsdb", function(err, db){
        db.collection("items", function(err, collection){
            collection.remove({"_id": new BSON.ObjectID(id)}, {safe: true}, function(err, result){
                if(err){
                    res.send({"error": "An error has occurred - " + err});
                }else{
                    console.log("" + result + " document(s) deleted");
                    res.send(req.body);
                }
                db.close();
            });
        });
    });
}

// Manually populate the database with dummy data - Only the first time
var populateDB = function(db){
    var items = [
        {
            firstname: "Christophe",
            lastname: "Jolif"
        },
        {
            firstname: "Ed",
            lastname: "Chatelain"
        }
    ];
    db.collection("items", function(err, collection){
        collection.insert(items, {safe: true}, function(err, result){
        });
        db.close();
    });

};
