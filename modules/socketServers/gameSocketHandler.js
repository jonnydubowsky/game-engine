/*
    Copyright (c) 2015, SerGIS Project Contributors. All rights reserved.
    Use of this source code is governed by the MIT License, which can be found
    in the LICENSE.txt file.
*/

// node modules
var fs = require("fs"),
    path = require("path");

// our modules
var config = require("../../config"),
    db = require("../db"),
    writer = require("../writer.js");


/**
 * Initialize the handler for connections to the "/game" socket.
 * This is called each time a new connection is made to the "/game" socket.
 *
 * @param socket - The Socket instance.
 * @param {Function} next - The function to call once we have initialized the
 *        socket on our end.
 */
module.exports = function (socket, next) {
    /*
    The client will send a "ready" event once it's all loaded up.
    data: {
        gameName: string
        authToken: string
    }
    callback(error message or null, initial game state)
    */
    socket.on("ready", function (data, callback) {
        var gameName = data.gameName,
            authToken = data.authToken;

        db.models.AuthToken.findOne({token: authToken}).populate("user").exec(function (err, authToken) {
            if (err || !authToken) {
                if (err) config.error(err, "checking auth token from socket");
                callback("Invalid auth token.");
                return;
            }
            
            // Check game name
            db.models.Game.findOne({name: gameName}).populate("initialGameState").exec(function (err, game) {
                if (err || !game) {
                    if (err) config.error(err, "getting game from game name");
                    callback("Invalid game name.");
                    return;
                }
                
                // We're all good; make GameSocket
                new GameSocket(socket, game, authToken, callback);
            });
        });
    });
    
    // Everything's initialized for us; move on!
    next();
};


/*
///////////////////////////////////////////////////////////////////////////////
// Writer for Content Component templates
var contentComponentTemplateWriter = new writer.Writer(config.CONTENT_COMPONENTS_TEMPLATES_DIR);

function getContentComponent(id, callback) {
    id = Number(id);
    if (isNaN(id) || !id || !TEST_CONTENT_COMPONENTS.hasOwnProperty(id)) {
        // "Bad Request"
        callback(new Error("Invalid control ID."));
        //writer.writeError(res, 400, "Invalid control ID.");
        return;
    }
    
    var contentComponent = TEST_CONTENT_COMPONENTS[id];
    contentComponentTemplateWriter.render(contentComponent.type + ".html", contentComponent.vars || {}, function (err, data) {
        if (err) {
            config.error(err, "rendering Content Component template");
            callback(new Error("Error rendering Content Component template."));
            // "Internal Server Error"
            //writer.writeError(res, 500, "Error rendering Content Component template.");
            return;
        }
        
        callback(null, data);
    });
}
*/



// Documentation for the callback functions to send a reply back to the client:
/**
 * A callback function to call in reply to an event sent by the client.
 * @callback GameSocket~requestCallback
 * @param {?string} err - An error message, or null if there was no error.
 * @param {*} [response] - Response data, if there was no error.
 */


/**
 * Class representing a socket connection with a specific game and user.
 * @class
 *
 * @param socket - The Socket.IO socket connection to the client.
 * @param {object} game - The game data from the database.
 * @param {object} authToken - The auth token for either the current user's
 *        session or an anonymous user's session (since not all games require
 *        login).
 * @param {GameSocket~requestCallback} initialCallback - The callback to give
 *        the client the initial game state.
 */
function GameSocket(socket, game, authToken, initialCallback) {
    this.socket = socket;
    this.game = game;
    this.authToken = authToken;
    
    // Make place for storing user variables
    // User variables are stored with the user if a user is logged in, or with
    // the auth token if no user is logged in.
    if (this.authToken.user) {
        // The user has never played this game before
        if (!this.authToken.user.playedGames[this.game._id]) {
            this.authToken.user.playedGames[this.game._id] = {
                userVars: {},
                currentGameState: this.game.initialGameState
            };
        }
        // Store reference to the current user/game state
        this.state = this.authToken.user.playedGames[this.game._id];
    } else {
        // Store with the auth token
        if (!this.authToken.playedGames[this.game._id]) {
            this.authToken.playedGames[this.game._id] = {
                userVars: {},
                currentGameState: this.game.initialGameState
            };
        }
        // Store reference to the current session/game state
        this.state = this.authToken.playedGames[this.game._id];
    }
    
    /**
     * Function to save the current user/game or session/game state.
     * @return {Promise}
     */
    this.saveState = function () {
        var that = this;
        return new Promise(function (resolve, reject) {
            that.authToken.save(function (err) {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    };
    
    // Save the current state
    var that = this;
    this.saveState().then(function () {
        // Set up socket handlers (getUserVar, setUserVar)
        for (var eventName in GameSocket.handlers) {
            if (GameSocket.handlers.hasOwnProperty(eventName)) {
                that.socket.on(eventName, GameSocket.handlers[eventName].bind(that));
            }
        }
        
        // Get dat client started
        initialCallback(null, that.game.gameStates[that.state.currentGameStateIndex].contentComponents);
    }, function (err) {
        // Ahhhh! Bad start!
        config.error(err, "saving initial session/user/game state");
        initialCallback("Error initializing game.");
    });
}

/**
 * Handlers for client socket events.
 * Each is called with 2 parameters: `data` and `callback` (both specified by
 * the client).
 * The `this` value in each function when it is called is the current GameSocket
 * instance.
 *
 * @type Array.<Function>
 */
GameSocket.handlers = {
    /**
     * Handler for client socket "getUserVar" event.
     * Called by the client to get the value of a user variable.
     *
     * @this GameSocket
     * @param {object} data - name (string): the name of the variable to get.
     * @param {GameSocket~requestCallback} callback
     */
    getUserVar: function (data, callback) {
        if (!data || !data.name) {
            callback("Invalid data.");
        } else if (!this.state.userVars.hasOwnProperty(data.name)) {
            callback("Invalid user variable name.");
        } else {
            callback(null, this.state.userVars[name]);
        }
    },

    /**
     * Handler for client socket "setUserVar" event.
     * Called by the client to set a user variable.
     *
     * @this GameSocket
     * @param {object} data - name (string): the name of the variable to set.
     *                        value (string): the value of the variable to set.
     * @param {GameSocket~requestCallback} callback
     */
    setUserVar: function (data, callback) {
        if (!data || !data.name) {
            callback("Invalid data.");
            return;
        }
        
        this.state.userVars[data.name] = data.value;
        this.saveState().then(function () {
            callback(null);
        }, function (err) {
            config.error(err, "setting user var");
            callback("Error setting user var.");
        });
    },
    
    /**
     * Handler for client socket "chooseActionSet" event.
     * Called by the client to perform all the actions in one of the current
     * GameState's actionSets.
     *
     * @this GameSocket
     * @param {object} data - actionSetIndex (number): the index of the action
     *                        set to choose in the GameState's actionSet array.
     * @param {GameSocket~requestCallback} callback
     */
    chooseActionSet: function (data, callback) {
        if (!data || typeof data.actionSetIndex != "number") {
            callback("Invalid data.");
            return;
        }
        
        //var actionSet = this.state.currentGameState.actionSets[data.actionSetIndex];
        var actionSet = {
            actions: [
                {
                    doAction: function () {
                        return new Promise(function (resolve, reject) {
                            console.log("Doing action #1");
                            setTimeout(function () {
                                console.log("Finished action #1");
                                resolve({});
                            }, 1000);
                        });
                    }
                },
                {
                    doAction: function () {
                        return new Promise(function (resolve, reject) {
                            console.log("Doing action #2");
                            setTimeout(function () {
                                console.log("Finished action #2");
                                resolve({});
                            }, 1000);
                        });
                    }
                },
                {
                    doAction: function () {
                        return new Promise(function (resolve, reject) {
                            console.log("Doing action #3");
                            setTimeout(function () {
                                console.log("Finished action #3");
                                resolve({});
                            }, 1000);
                        });
                    }
                }
            ]
        };
        
        if (!actionSet) {
            callback("Invalid data.");
        } else if (actionSet.actions.length == 0) {
            // No actions
            callback(null);
        } else {
            var actionsPromise;
            // Run asynchronously?
            if (actionSet.async) {
                actionsPromise = runActionsAsync(this, actionSet);
            } else {
                actionsPromise = runActions(this, actionSet);
            }
            // Call the callback when we're done
            actionsPromise.then(function (gameStateNeedsReloading) {
                // Check if game state needs reloading
                if (gameStateNeedsReloading) {
                    console.log("::: UPDATE GAME STATE :::");
                    // return updateGameState_PromiseReturningFunction(...);
                }
            }).then(function () {
                // All done! Success!
                callback(null);
            }, function (err) {
                // Fail!
                config.error(err, "performing actionSet " + data.actionSetIndex);
                callback("Error completing action set.");
            });
        }
    }
};



/**
 * Run some actions asynchronously.
 *
 * @param {GameSocket} gameSocket - The GameSocket with the current state.
 * @param {Object} actionSet - The actionSet (see models/GameState.js).
 *
 * @return {Promise.<Boolean>} Resolved when all the actions are complete;
 *         resolved to `true` if the game state needs to be reloaded.
 */
function runActionsAsync(gameSocket, actionSet) {
    // Do each action, creating a Promise for each one
    // (so we can call `callback` when they're all done).
    var gameStateNeedsReloading = false;
    return Promise.all(actionSet.actions.map(function (action) {
        return runAction(gameSocket, action).then(function (_gameStateNeedsReloading) {
            if (_gameStateNeedsReloading) gameStateNeedsReloading = true;
        });
    }));
}


/**
 * Run some actions synchronously.
 *
 * @param {GameSocket} gameSocket - The GameSocket with the current state.
 * @param {Object} actionSet - The actionSet (see models/GameState.js).
 * @param {Number} [currentAction=0] - The action to do.
 * @param {Boolean} [gameStateNeedsReloading=false] - Whether the game state
 *        needs reloading (so far).
 *
 * @return {Promise.<Boolean>} Resolved when all the actions are complete;
 *         resolved to `true` if the game state needs to be reloaded.
 */
function runActions(gameSocket, actionSet, currentAction, gameStateNeedsReloading) {
    return new Promise(function (resolve, reject) {
        // Do the actions in the set one by one
        if (!currentAction) currentAction = 0;
        if (actionSet.actions[currentAction]) {
            // We have an action to do!
            runAction(gameSocket, actionSet.actions[currentAction]).then(function (_gameStateNeedsReloading) {
                // Run the next action
                resolve(runActions(gameSocket, actionSet, currentAction + 1, gameStateNeedsReloading || _gameStateNeedsReloading));
            }, reject);
        } else {
            // All done
            resolve(!!gameStateNeedsReloading);
        }
    });
}


/**
 * Run a single action.
 *
 * @param {GameSocket} gameSocket - The GameSocket with the current state.
 * @param {Action} action - The action to run (see models/actions.js).
 *
 * @return {Promise.<Boolean>} Resolved when running the action is complete;
 *         resolved to `true` if the game state needs to be reloaded.
 */
function runAction(gameSocket, action) {
    console.log("RUNNING ACTION: ", action);
    var response;
    return action.doAction(gameSocket.state).then(function (_response) {
        // Step 1: store the response from the action's "doAction"
        response = _response;
        // Save any changes made to the state, and continue after that's done
        return gameSocket.saveState();
    }).then(function () {
        // Step 3: Send socket events if necessary.
        if (response.socketEvents && Array.isArray(response.socketEvents)) {
            // Send each socket event, creating a Promise for each one
            // (so we'll continue when they're all sent).
            return Promise.all(response.socketEvents.map(function (socketEvent) {
                return new Promise(function (resolve, reject) {
                    if (socketEvent.waitForCallback) {
                        gameSocket.socket.emit(socketEvent.event, socketEvent.data, function () {
                            resolve();
                        });
                    } else {
                        gameSocket.socket.emit(socketEvent.event, socketEvent.data);
                        resolve();
                    }
                });
            }));
        }
    }).then(function () {
        // Resolve the promise with whether the game state needs reloading
        return !!response.reloadGameState;
    });
}
