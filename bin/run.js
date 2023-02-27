#! /usr/bin/env node
var shell = require("shelljs");
var cd = "./node_modules/bpa-custom-builder/bin/";

let args = "";
if (process.argv) {
  args = process.argv.splice(2).join(" ");
}

shell.exec("node " + cd + "compile.js " + args);
