'use strict';
var fs = require('fs');
var config = require('config');
var uuid = require('uuid');
var obfuscate = require('./obfuscator');
var express = require('express');
var os = require('os');
var child_process = require('child_process');

var WebSocketServer = require('ws').Server;
var app = require('./web/server')();

var WebSocketServer = require('ws').Server;

var wss = null;

var server;
var tempPath = 'temp';

class ProcessQueue {
    constructor() {
        this.maxProc = os.cpus().length;
        this.q = [];
        this.numProc = 0;
    }
    enqueue(clientid) {
        this.q.push(clientid);
        if (this.numProc < this.maxProc) {
            process.nextTick(this.process.bind(this));
        } else {
            console.log('process Q too long:', this.numProc);
        }
    }
    process() {
        var clientid = this.q.shift();
        if (!clientid) return;
        child_process.fork('extract.js', [clientid]).on('exit', () => {
            this.numProc--;
            console.log('done', clientid, this.numProc);
            if (this.numProc < 0) this.numProc = 0;
            if (this.numProc < this.maxProc) process.nextTick(this.process.bind(this));
        });
        this.numProc++;
        console.log('process Q:', this.numProc);
    }
}
var q = new ProcessQueue();

function setupWorkDirectory() {
    try {
        fs.readdirSync(tempPath).forEach(function(fname) {
            fs.unlinkSync(tempPath + '/' + fname); 
        });
        fs.rmdirSync(tempPath);
    } catch(e) {
        console.error('work dir does not exist');
    }
    fs.mkdirSync(tempPath);
}

function run(keys) {
    setupWorkDirectory();

    app.use('/static', express.static(__dirname + '/static'));

    if (keys === undefined) {
      server = require('http').Server(app);
    } else {
      server = require('https').Server({
          key: keys.serviceKey,
          cert: keys.certificate,
      }, app);
    }

    server.listen(config.get('server').port);
    wss = new WebSocketServer({ server: server });

    wss.on('connection', function(client) {
        // the url the client is coming from
        var referer = client.upgradeReq.headers['origin'] + client.upgradeReq.url;
        // TODO: check against known/valid urls

        var ua = client.upgradeReq.headers['user-agent'];
        var clientid = uuid.v4();
        var tempStream = fs.createWriteStream(tempPath + '/' + clientid);
        tempStream.on('finish', function() {
            q.enqueue(clientid);
        });

        var meta = {
            path: client.upgradeReq.url,
            origin: client.upgradeReq.headers['origin'],
            url: referer,
            userAgent: ua,
            time: Date.now()
        };
        tempStream.write(JSON.stringify(meta) + '\n');


        console.log('connected', ua, referer);
        client.on('message', function (msg) {
            var data = JSON.parse(msg);
            switch(data[0]) {
            case 'getUserMedia':
            case 'getUserMediaOnSuccess':
            case 'getUserMediaOnFailure':
            case 'navigator.mediaDevices.getUserMedia':
            case 'navigator.mediaDevices.getUserMediaOnSuccess':
            case 'navigator.mediaDevices.getUserMediaOnFailure':
                data.time = Date.now();
                tempStream.write(JSON.stringify(data) + '\n');
                break;
            default:
                obfuscate(data);
                data.time = Date.now();
                tempStream.write(JSON.stringify(data) + '\n');
                break;
            }
        });

        client.on('close', function() {
            tempStream.end();
            tempStream = null;
        });
    });
}

function stop() {
    if (server) {
        server.close();
    }
}

run();

module.exports = {
    stop: stop
};
