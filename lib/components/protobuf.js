var fs = require('fs');
var path = require('path');
var protobuf = require("node-protobuf");
var SERVER = 'server';
var CLIENT = 'client';
var logger = require('pomelo-logger').getLogger('pomelo', __filename);

module.exports = function(app, opts) {
    return new Component(app, opts);
};

var Component = function(app, opts) {
    this.app = app;
    this.version = 0;
    this.watchers = {};
    opts = opts || {};
    this.watchFile = !!opts.watchFile;
    this.serverProtosPathDESC = opts.serverProtosDESC || '/config/serverProtos.desc';
    this.clientProtosPathDESC = opts.clientProtosDESC || '/config/clientProtos.desc';

    this.serverMessageCache = {};
    this.clientMessageCache = {};
};

var pro = Component.prototype;

pro.name = '__decodeIO__protobuf__';

var loadProto = function (path) {
    try {
        return new protobuf(fs.readFileSync(path));
    }
    catch (err) {
        return null;
    }
};

pro.start = function(cb) {
    this.setProtos(SERVER, path.join(this.app.getBase(), this.serverProtosPathDESC));
    this.setProtos(CLIENT, path.join(this.app.getBase(), this.clientProtosPathDESC));

    this.encodeBuilder = loadProto(path.join(this.app.getBase(), this.serverProtosPathDESC));
    this.decodeBuilder = loadProto(path.join(this.app.getBase(), this.clientProtosPathDESC));
    process.nextTick(cb);
};

pro.check = function(type, route) {
    var exists, routeT;
    switch(type) {
        case SERVER:
            if(!this.encodeBuilder) {
                logger.warn('decodeIO encode builder is undefined.');
                return null;
            }
            exists = this.serverMessageCache[route];
            if (exists === undefined) {
                routeT = route.replace(/\./g, "_");
                exists = this.serverMessageCache[route] = this.encodeBuilder.lookupMessage(routeT);
            }
            return exists;
            break;
        case CLIENT:
            if(!this.decodeBuilder) {
                logger.warn('decodeIO decode builder is undefined.');
                return null;
            }
            exists = this.clientMessageCache[route];
            if (exists === undefined) {
                routeT = route.replace(/\./g, "_");
                exists = this.clientMessageCache[route] = this.decodeBuilder.lookupMessage(routeT);
            }
            return exists;
            break;
        default:
            throw new Error('decodeIO meet with error type of protos, type: ' + type + ' route: ' + route);
            break;
    }
};

pro.encode = function(route, message) {
    return this.encodeBuilder.serialize(message, route.replace(/\./g, "_"));
};

pro.decode = function(route, message) {
    return this.decodeBuilder.parse(message, route.replace(/\./g, "_"));
};

pro.getProtos = function() {
    return {
        server : this.serverProtos,
        client : this.clientProtos,
        version : this.version
    };
};

pro.getVersion = function() {
    return this.version;
};

pro.setProtos = function(type, path) {
    if(!fs.existsSync(path)) {
        return;
    }

    if(type === SERVER) {
        this.serverProtos = {
            desc: fs.readFileSync(path).toString('base64')
        };
    }

    if(type === CLIENT) {
        this.clientProtos = {
            desc: fs.readFileSync(path).toString('base64')
        };
    }

    //Set version to modify time
    var time = fs.statSync(path).mtime.getTime();
    if(this.version < time) {
        this.version = time;
    }

    //Watch file
    if (this.watchFile) {
        var watcher = fs.watch(path, this.onUpdate.bind(this, type, path));
        if (this.watchers[type]) {
            this.watchers[type].close();
        }
        this.watchers[type] = watcher;
    }
};

pro.onUpdate = function(type, path, event) {
    if(event !== 'change') {
        return;
    }

    var self = this;
    fs.readFile(path ,function(err, data) {
        try {
            if(type === SERVER) {
                self.serverProtos = {
                    desc: data.toString('base64')
                };
            } else {
                self.clientProtos = {
                    desc: data.toString('base64')
                };
            }

            self.version = fs.statSync(path).mtime.getTime();
            logger.debug('change proto file , type : %j, path : %j, version : %j', type, path, this.version);
        } catch(e) {
            logger.warn("change proto file error! path : %j", path);
            logger.warn(e);
        }
    });
};

pro.stop = function(force, cb) {
    for (var type in this.watchers) {
        this.watchers[type].close();
    }
    this.watchers = {};
    process.nextTick(cb);
};
