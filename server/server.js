'use strict';
require('events').EventEmitter.defaultMaxListeners = 100
require("dotenv").config();
const admin = require("firebase-admin"),
      kue = require('kue'),
      async = require("async"),
      Agent = require('agentkeepalive'),
      request = require('request').defaults({maxRedirects:20}),
      sleep = require('sleep'),
      _ = require("lodash");

const BLYNK_API_URL = process.env.BLYNK_API_URL;
const credFile = process.env.FIREBASE_SVC_ACC_FILE || "./iot-door-sensor.json";
var serviceAccount = require(credFile);
var counter = 0;
var intervalValue = parseInt(process.env.JOB_INTERVAL);
var timeoutValue = parseInt(process.env.JOB_TIMEOUT);  
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DB_URL
});

var db = admin.database();

var counter= 0;
// The polling function
function poll(fn, timeout, interval) {
    var endTime = Number(new Date()) + (timeout || 2000);
    interval = interval || 100;

    var checkCondition = function(resolve, reject) {
        // If the condition is met, we're done! 
        var result = fn();
        if(result) {
            resolve(result);
        }
        // If the condition isn't met but the timeout hasn't elapsed, go again
        else if (Number(new Date()) < endTime) {
            setTimeout(checkCondition, interval, resolve, reject);
        }
        // Didn't match and too much time, reject!
        else {
            forceGC();
            reject(new Error('timed out for ' + fn + ': ' + arguments));
        }
    };

    return new Promise(checkCondition);
}

function startPoll(){
    poll(function() {
      createQueueJob();
    }, timeoutValue, intervalValue).then(function(result) {
        // Polling done, now do something else!
        console.log(result);
    }).catch(function(error) {
        // Polling timed out, handle the error!
        console.log("ERROR !!!!!");
        console.warn(error);
        forceGC();
        startPoll();
    });
    
}

// Usage:  ensure element is visible
startPoll();

function forceGC(){
    if(global.gc){
       global.gc();
    } else {
       console.warn('No GC hook! Start your program as `node --expose-gc file.js`.');
    }
 }

function createQueueJob(){
  request.get({url: `${BLYNK_API_URL}`, jar: true}, function(err, resp, body){
    if(err) return;
    let doorRef = db.ref("door");
    doorRef.on(
      "value",
      function(snapshot) {
        counter = 0;
        let arrOfDoors = [];
        if(!(_.isNil(snapshot)) && !(_.isNil(snapshot.val()))){
          for (let k of Object.keys(snapshot.val())) {
            let d = {
              key: k,
              data: snapshot.val()[k]
            };
            arrOfDoors.push(d);
          }
          arrOfDoors.forEach(function (door, key) {
            console.log(key);
            const used = process.memoryUsage().heapUsed / 1024 / 1024;
            console.log(`Server uses approximately ${Math.round(used * 100) / 100} MB`);
            console.log("datetime > " + new Date());
            console.log("counter >>>>> " + (arrOfDoors.length-1));
            if(counter == (arrOfDoors.length-1)){
              counter = 0;
            }
            counter++;
            if(typeof(door.data.name) !=='undefined'){
              console.log('CHECK DOOR SENSORS CONNECTED ' + door.data.name);
              const queue = kue.createQueue();
              const job = queue.create('checkSensor', {
                  title: 'checkSensor',
                  door: JSON.stringify(door),
                  index: arrOfDoors.indexOf(door)
                })
                .removeOnComplete(true)
                .save((err) => {
                  if (err) {
                    console.log('CHECK DOOR SENSORS JOB SAVE FAILED');
                    doorRef = null;
                    return;
                  }
                  job.on('complete', (result) => {
                    console.log('<CHECK DOOR SENSORS JOB COMPLETE>');
                    console.log(result);
                    doorRef = null;
                    arrOfDoors = null;
                  });
                  job.on('failed', (errorMessage) => {
                    console.log('CHECK DOOR SENSORS JOB FAILED');
                    console.log(errorMessage);
                    doorRef = null;
                    return;
                  });
                });
            }
          }, (err) => {
            console.warn("ERROR ERROR !!!!!");
            console.warn(err);
            startPoll();
          }); 
        }
        console.log('CHECK DOOR SENSORS CONNECTED');
      },
      function(errorObject) {
        console.warn("ERROR ERROR !!!!!");
        console.warn("ERROR ERROR !!!!!");
        console.error("The read failed: " + errorObject.code);
        startPoll();
      }
    );   
  }).on('error', function(e){
      console.warn("ERROR ERROR !!!!!");
      console.warn("ERROR ERROR !!!!!");
      console.log(e);
      startPoll();
  }).end();
}