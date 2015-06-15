'use strict';

var _ = require('lodash');
var THREE = require('three');
var Immutable = require('immutable');

var Class = require('core/Class.js');
var EventEmitter = require('core/EventEmitter.js');
var NodeCollection = require('core/NodeCollection.js');
var IO = require('IO.js');

var Composer = require('graphics/Composer.js');
var RenderPass = require('graphics/RenderPass.js');
var ShaderPass = require('graphics/ShaderPass.js');
var CopyShader = require('shaders/CopyShader.js');
var ColorHalftoneShader = require('shaders/ColorHalftoneShader.js');
var ColorShiftShader = require('shaders/ColorShiftShader.js');
var HexagonPixelateShader = require('shaders/HexagonPixelateShader.js');
var GridShader = require('shaders/GridShader.js');

var EdgeShader = require('../vendor/three/shaders/EdgeShader2.js');
var DotScreenShader = require('../vendor/three/shaders/DotScreenShader.js');
var RGBShiftShader = require('../vendor/airtight/shaders/RGBShiftShader.js');

var defaults = {
    showFPS: false,
    audioOutput: 'mux',
    videoOutput: 'mp4',
    width: 854,
    height: 480
};

var Stage = function(options) {
    this.stats = {
        fps: 0,
        ms: 0,
        time: 0,
        frames: 0,
        stack: []
    };
    
    this.scenes = new NodeCollection();

    this.scene = new THREE.Scene();
    this.clock = new THREE.Clock();

    this.options = _.assign({}, defaults);

    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    this.renderer.setSize(854, 480);
    this.renderer.autoClear = false;

    this.update(options);
};

Class.extend(Stage, NodeCollection, {
    update: function(options) {
        if (typeof options !== 'undefined') {
            for (var prop in options) {
                if (hasOwnProperty.call(this.options, prop)) {
                    this.options[prop] = options[prop];
                }
            }
        }
    },

    addScene: function(scene) {
        this.scenes.addNode(scene);

        scene.addToStage(this);
    },

    removeScene: function(scene) {
        this.scenes.removeNode(scene);

        scene.removeFromStage(this);
    },

    moveScene(scene, i) {
        var index = this.scenes.indexOf(scene);

        this.scenes.swapNodes(index, index + i);
    },

    getScenes: function() {
        return this.scenes.nodes.toJS();
    },

    getDisplays: function() {
        var displays = [];

        this.scenes.nodes.forEach(function(scene) {
            scene.displays.nodes.forEach(function(display) {
                displays.push(display);
            });
        });

        return displays;
    },

    hasScenes: function() {
        return this.scenes.nodes.size > 0;
    },

    loadCanvas: function(canvas) {
        var canvas3d = this.canvas3d = canvas,
            canvas2d = this.canvas2d = document.createElement('canvas'),
            scene = this.scene,
            width = canvas.width,
            height = canvas.height;

        this.width = width;
        this.height = height;

        // Renderer
        var renderer = this.renderer = new THREE.WebGLRenderer({
            canvas: canvas3d,
            antialias: false
        });
        renderer.autoClear = false;

        // Scene 2D
        canvas2d.width = width;
        canvas2d.height = height;

        // Camera 3D
        var camera = this.camera = new THREE.PerspectiveCamera(45, width/height, 1, 10000);
        camera.position.set(0, 0, 10);

        // Texture 2D
        var texture = this.texture = new THREE.Texture(canvas2d);
        texture.minFilter = THREE.LinearFilter;

        // Rendering context
        this.context2d = canvas2d.getContext('2d');
        this.context3d = canvas3d.getContext('webgl');

        // Processing
        var composer = this.composer = new Composer(renderer);
        //composer.addRenderPass(scene, camera);
        //composer.addShaderPass(ColorShiftShader);
        //composer.addShaderPass(DotScreenShader);
        //composer.addShaderPass(EdgeShader);
        //composer.addShaderPass(RGBShiftShader);
        //composer.addRenderPass(scene2d, camera2d, { forceClear: false });
        composer.addTexturePass(texture);
        //composer.addShaderPass(DotScreenShader);
        //composer.addShaderPass(GridShader);
        //composer.addShaderPass(RGBShiftShader);
        composer.renderToScreen();

        //console.log(composer);
    },

    clearCanvas: function() {
        var canvas = this.canvas2d,
            context = this.context2d;

        context.clearRect(0, 0, canvas.width, canvas.height);
    },

    renderFrame: function(data, callback) {
        this.renderer.clear();

        this.getScenes().forEach(function(scene) {
            scene.render(data);
        });

        this.updateFPS();

        if (callback) callback();
    },

    renderFrame2: function(data, callback) {
        var displays = this.getDisplays();

        this.clearCanvas();
        this.renderer.clear();

        // Render canvas displays
        displays.reverse().forEach(function(display) {
            if (display.renderToCanvas) {
                display.renderToCanvas(this, data);
            }
        }, this);

        this.composer.render();

        // Render 3D displays
        displays.reverse().forEach(function(display) {
            if (display.updateScene) {
                display.updateScene(this, data);
            }
        }, this);

        this.updateFPS();

        if (callback) callback();
    },

    renderVideo: function(output_file, fps, duration, func, callback) {
        var started = false,
            frames = duration * fps,
            input_file = new IO.Stream.Transform();

        console.log('rending movie', duration, 'seconds,', fps, 'fps');

        input_file.on('error', function(err) {
            console.log(err);
        });

        this.callback = function(next) {
            if (next < frames) {
                this.renderImage(function(buffer) {
                    input_file.push(buffer);
                    func(next, fps, this.callback);
                }.bind(this));
            }
            else {
                input_file.push(null);
            }
        }.bind(this);

        var ffmpeg = IO.Spawn('./bin/ffmpeg.exe', ['-y', '-f', 'image2pipe', '-vcodec', 'png', '-r', fps, '-i', 'pipe:0', '-vcodec', 'libx264', '-movflags', '+faststart', '-pix_fmt', 'yuv420p', '-f', 'mp4', output_file]);
        input_file.pipe(ffmpeg.stdin);
        //ffmpeg.stdout.pipe(outStream);

        ffmpeg.stderr.on('data', function(data) {
            console.log(data.toString());
            if (!started) {
                func(0, fps, this.callback);
                started = true;
            }
        }.bind(this));

        ffmpeg.stderr.on('end', function() {
            console.log('file has been converted succesfully');
            if (callback) callback();
        });

        ffmpeg.stderr.on('exit', function() {
            console.log('child process exited');
        });

        ffmpeg.stderr.on('close', function() {
            console.log('program closed');
        });
    },

    renderImage: function(callback, format) {
        this.renderToCanvas(function() {
            var img = this.renderer.domElement.toDataURL(format || 'image/png'),
                data = img.replace(/^data:image\/\w+;base64,/, ''),
                buffer = new IO.Buffer(data, 'base64');

            if (callback) callback(buffer);
        }.bind(this));
    },

    getSize: function() {
        var canvas =  this.canvas3d;

        return {
            width: canvas.width,
            height: canvas.height
        };
    },

    updateFPS: function() {
        var now = performance.now(),
            stats = this.stats;

        if (!stats.time) {
            stats.time = now;
        }

        stats.frames += 1;

        if (now > stats.time + 1000) {
            stats.fps = Math.round((stats.frames * 1000) / (now - stats.time));
            stats.ms = (now - stats.time) / stats.frames;
            stats.time = now;
            stats.frames = 0;

            stats.stack.push(stats.fps);

            if (stats.stack.length > 10) {
                stats.stack.shift();
            }

            this.emit('tick', stats);
        }
    },

    toJSON: function() {
        var scenes = this.scenes.map(function(scene) {
            return scene.toJSON();
        });

        return {
            scenes: scenes,
            options: this.options
        };
    }
});

module.exports = Stage;