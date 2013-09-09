#!/bin/env node
//  OpenShift sample Node application
var express = require('express');
var fs    = require('fs');
var MongoClient = require('mongodb').MongoClient
var database = null;


// default to a 'localhost' configuration:
var connection_string = '127.0.0.1:27017/api';

// if OPENSHIFT env variables are present, use the available connection info:
if(process.env.OPENSHIFT_MONGODB_DB_PASSWORD){
  connection_string = process.env.OPENSHIFT_MONGODB_DB_USERNAME + ":" +
  process.env.OPENSHIFT_MONGODB_DB_PASSWORD + "@" +
  process.env.OPENSHIFT_MONGODB_DB_HOST + ':' +
  process.env.OPENSHIFT_MONGODB_DB_PORT + '/' +
  process.env.OPENSHIFT_APP_NAME;
}

MongoClient.connect('mongodb://' + connection_string, function(err, db) {
  if(!err) {
    database = db;
  }
});

/**
 *  Define the sample application.
 */
var SampleApp = function() {

  //  Scope.
  var self = this;


  /*  ================================================================  */
  /*  Helper functions.                                                 */
  /*  ================================================================  */

  /**
   *  Set up server IP address and port # using env variables/defaults.
   */
  self.setupVariables = function() {
    //  Set the environment variables we need.
    self.ipaddress = process.env.OPENSHIFT_NODEJS_IP;
    self.port    = process.env.OPENSHIFT_NODEJS_PORT || 8080;

    if (typeof self.ipaddress === "undefined") {
      //  Log errors on OpenShift but continue w/ 127.0.0.1 - this
      //  allows us to run/test the app locally.
      console.warn('No OPENSHIFT_NODEJS_IP var, using 127.0.0.1');
      self.ipaddress = "127.0.0.1";
    };
  };


  /**
   *  Populate the cache.
   */
  self.populateCache = function() {
    if (typeof self.zcache === "undefined") {
      self.zcache = { 'index.html': '' };
    }

    //  Local cache for static content.
    self.zcache['index.html'] = fs.readFileSync('./index.html');
  };


  /**
   *  Retrieve entry (content) from cache.
   *  @param {string} key  Key identifying content to retrieve from cache.
   */
  self.cache_get = function(key) { return self.zcache[key]; };


  /**
   *  terminator === the termination handler
   *  Terminate server on receipt of the specified signal.
   *  @param {string} sig  Signal to terminate on.
   */
  self.terminator = function(sig){
    if (typeof sig === "string") {
       console.log('%s: Received %s - terminating sample app ...',
             Date(Date.now()), sig);
       process.exit(1);
    }
    console.log('%s: Node server stopped.', Date(Date.now()) );
  };


  /**
   *  Setup termination handlers (for exit and a list of signals).
   */
  self.setupTerminationHandlers = function(){
    //  Process on exit and signals.
    process.on('exit', function() { self.terminator(); });

    // Removed 'SIGPIPE' from the list - bugz 852598.
    ['SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGILL', 'SIGTRAP', 'SIGABRT',
     'SIGBUS', 'SIGFPE', 'SIGUSR1', 'SIGSEGV', 'SIGUSR2', 'SIGTERM'
    ].forEach(function(element, index, array) {
      process.on(element, function() { self.terminator(element); });
    });
  };


  /*  ================================================================  */
  /*  App server functions (main app logic here).             */
  /*  ================================================================  */

  /**
   *  Create the routing table entries + handlers for the application.
   */
  self.createRoutes = function() {
    self.routes = { };

    self.routes['/health'] = function(req, res) {
      res.send('1');
    };

    self.routes['/'] = function(req, res) {
      res.setHeader('Content-Type', 'text/html');
      res.send(self.cache_get('index.html') );
    };

    self.routes['/info'] = function(req, res) {
      cursor = database.collection('info').find({}, {_id: 0});
      cursor.nextObject(function(err, doc) {
        if(err) {
          res.send(500, { 'error': 'Something blew up!' });
        } else {
          res.send(doc);
        }
      });
    };

    self.routes['/web'] = function(req, res) {
      cursor = database.collection('web').find({}, {_id: 0});
      cursor.nextObject(function(err, doc) {
        if(err) {
          res.send(500, { 'error': 'Something blew up!' });
        } else {
          res.send(doc);
        }
      });
    }

    self.routes['/organizations'] = function(req, res) {
      if(req.query.type == 'edu' || req.query.type == 'work') {
        cursor = database.collection('organizations').find({'category': req.query.type}, {_id: 0});
      } else {
        cursor = database.collection('organizations').find({}, {_id: 0});
      }
      cursor.toArray(function(err, docs) {
        if(err) {
          res.send(500, { 'error': 'Something blew up!' });
        } else {
          res.send(docs);
        }
      });
    }

    self.routes['/likes'] = function(req, res) {
      database.collection('likes').distinct('category', function(err, doc) {
        if(err) {
          res.send(500, { 'error': 'Something blew up!' });
        } else {
          res.send(doc);
        }
      });
    }

    self.routes['/likes/:category'] = function(req, res) {
      if(req.params.category == 'softwares' ||
          req.params.category == 'books' ||
            req.params.category == 'movies') {
        database.collection('likes').find({'category': req.params.category}, {_id: 0}).sort({'weight': -1}).toArray(function(err, docs) {
          if(err) {
            res.send(500, { 'error': 'Something blew up!' });
          } else {
            res.send(docs);
          }
        });
      } else {
        res.send(404);
      }
    }
  };


  /**
   *  Initialize the server (express) and create the routes and register
   *  the handlers.
   */
  self.initializeServer = function() {
    self.createRoutes();
    self.app = express();

    self.app.use(express.bodyParser());

    //  Add handlers for the app (from the routes).
    for (var r in self.routes) {
      self.app.get(r, self.routes[r]);
    }

    // Special case, need to refactor
    self.app.post('/postman', function(req, res) {
      if(req.body.name && req.body.name.length > 2 &&
          req.body.email && /.+@.+\..+/.test(req.body.email) &&
            req.body.message && req.body.message.length > 5) {

        database.collection('feedbacks').insert(req.body, function(err, obj){
          if(err) {
            res.send(500, { 'error': 'Something blew up!' });
          } else {
            res.send(200);
          }
        });

      } else {
        res.send(400);
      }

    });
  };


  /**
   *  Initializes the sample application.
   */
  self.initialize = function() {
    self.setupVariables();
    self.populateCache();
    self.setupTerminationHandlers();

    // Create the express server and routes.
    self.initializeServer();
  };


  /**
   *  Start the server (starts up the sample application).
   */
  self.start = function() {
    //  Start the app on the specific interface (and port).
    self.app.listen(self.port, self.ipaddress, function() {
      console.log('%s: Node server started on %s:%d ...',
            Date(Date.now() ), self.ipaddress, self.port);
    });
  };

};   /*  Sample Application.  */



/**
 *  main():  Main code.
 */
var zapp = new SampleApp();
zapp.initialize();
zapp.start();

