/*
    Copyright (c) 2015, SerGIS Project Contributors. All rights reserved.
    Use of this source code is governed by the MIT License, which can be found
    in the LICENSE.txt file.
*/

// our modules
var config = require("../../config"),
    contentComponentTypes = require("../contentComponentTypes");


// The Game model (created in the `module.exports` function below)
var Game;


module.exports = function (mongoose, extend) {
    var Schema = mongoose.Schema;
    
    // Game schema
    var gameSchema = new Schema({
        // The name of the game (must be URL-allowed)
        name: {
            type: String,
            unique: true,
            required: true,
            validator: function (value) {
                // Check for illegal URL characters
                // Only allow the things that are allowed by encodeURIComponent:
                //    alphabetic, decimal digits, - _ . ! ~ * ' ( )
                return /^[A-Za-z0-9\-_\.!~*'()]+$/.test(value);
            }
        },
        
        // The display name
        displayName: {
            type: String
        },

        // The initial game state that the user starts in (corresponds to an index
        // in gameStates)
        initialGameStateIndex: Number,

        // The game states that make up this game
        gameStates: [{
            type: Schema.Types.ObjectId,
            ref: "GameState"
        }],
        
        // The access permissions for the game
        // "public" (default): anyone can access without login
        // "protected": anyone with an account can access
        // "private": users must specifically be allowed to access
        access: {
            type: String,
            default: "public",
            validator: function (value) {
                return ["public", "protected", "private"].indexOf(value) != -1;
            }
        }
    });
    
    
    // Game model
    return (Game = mongoose.model("Game", gameSchema));
};
