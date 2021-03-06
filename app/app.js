'use strict';

//
// Debug
//
const stringifyObject = require('stringify-object');
function pretty(data) {
    return "<pre>" + stringifyObject(data) + "</pre>";
}

const os = require('os');
function running_on_pi() {
    // very hacky way to determine
    // better: https://github.com/fourcube/detect-rpi
    return os.arch() === 'arm';
}

//
// Sub modules
//
const Config = require('./src/config.js');
const cache = require('./src/cache.js');
cache.init_discogs();
const DG = require('./src/discogs.js');
const searcher = require('./src/search.js');

//
// Express REST server
//
const express = require('express');
const app = express();

function get_pub_dir() {
    return __dirname + '/public/';
}
app.use(express.static(get_pub_dir()));

// always have this ready
const fs = require('fs');
const templ_file = fs.readFileSync(get_pub_dir() + 'results.template.html', 'utf8');

//
// index routing & debug
//
app.get('/', function (req, res) {
    res.sendFile('index.html', { root: get_pub_dir() }); 
});

app.get('/info', function (req, res) {
    var info = {
        client: Config.Discogs.UserAgent,
        uptime: os.uptime(),
        cpu: os.cpus(),
        archicture: os.arch(),
        type: os.type()
    };
    res.send(pretty(info));
});

//
// Direct Discogs queries
//
app.get('/all', function (req, res) {
    res.send(pretty(DG.raw_col));
});

app.get('/detail/:id(\\d+)', function (req, res) {
    DG.api_db.getRelease(req.params.id, function(err, data){
        if (err) {
            res.send(pretty(err));
            return;
        }
        res.send(pretty(data));
    });
});

//
// Search
//
const cmd_search = require('./src/cmd_search.js');

app.get('/search', function (req, res) {
    res.send(cmd_search(req, templ_file, get_pub_dir(), running_on_pi()));
});

//
// Finder
//
const cmd_find = require('./src/cmd_find.js');

app.get('/find/:id(\\d+)', function (req, res) {
    // if (!running_on_pi()) {
    //     res.send('Err: find can only run on the Raspberry Pi!');
    //     return;
    // }
    cmd_find(req, res);
});

//
// Play dialog and tracks
//
const lru = require('./src/lru.js');

const cmd_play = require('./src/cmd_play.js');
app.get('/play/:id(\\d+)', function (req, res) {
    cmd_play(req, res);
});

//
// Sqlite local database
//
const db = function() {
    const disable = process.argv.find(arg => arg === '--no-db');
    return (disable) ? undefined : require('./src/sqlite.js');
}();

app.get('/db-create', function (req, res) {
    db.create();
    res.send("Creating database...");
});

//
// Last.fm
//
const last_fm = function() {
    const disable = process.argv.find(arg => arg === '--no-lastfm');
    return (disable) ? undefined : require('./src/last_fm.js');
}();

app.get('/last.fm/:id(\\d+)/:type', function (req, res) {
    var entry = DG.find_by_id(req.params.id);

    if (!lru.track_list.length || !entry) {
        res.send('invalid request');
        return;
    }

    var cmd = req.params.type;
    var to_submit = lru.filter(cmd);
    if (!to_submit) {
        res.send('invalid request');
        return;
    }

    if (db) {
        var info = {
            $release: entry.id,
            $timestamp: lru.timestamp(),
            $shelf_id: DG.get_shelf_id(entry),
            $shelf_pos: DG.get_shelf_pos(entry),
            $cmd: cmd,
            $track_data: stringifyObject(to_submit)
        };
        db.add(info);
    }

    if (last_fm) {
        last_fm.scrobble(to_submit, res);
    } else {
        res.send('Last.fm disabled');
    }
});

//
// Main
//
console.log("Starting...");

function start_server(){
    app.listen(Config.Server.Port, function () {
        console.log('Listening on ' + Config.Server.Port + '...');
    }); 
}

DG.load(function () {
    searcher.init_search(DG.raw_col);
    start_server();
});
