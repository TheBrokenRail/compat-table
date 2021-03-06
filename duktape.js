/*
 *  Node.js test runner for running data-*.js tests with Duktape 'duk' command.
 *
 *  Reports discrepancies to console; fix them manually in data-*.js files.
 *  Expects a './duk' command in the current directory.  Example:
 *  (Configure with -DDUK_USE_SYMBOL_BUILTIN and -DDUK_USE_GLOBAL_BINDING)
 *
 *    $ cp /path/to/duk ./duk
 *    $ node duktape.js
 */

var fs = require('fs');
var child_process = require('child_process');

var testCount = 0;
var testSuccess = 0;
var testOutOfDate = 0;

var dukCommand = './duk';

var environments = JSON.parse(fs.readFileSync('environments.json').toString());

// Key for .res (e.g. test.res.duktape2_0), automatic based on Duktape.version.
var dukKey = (function () {
    var stdout = child_process.execFileSync(dukCommand, [ '-e', 'print(Duktape.version)' ], {
        encoding: 'utf-8'
    });
    var dukVersion = Number(stdout);
    console.log('Duktape version is: ' + dukVersion);
    if ((dukVersion % 100) == 99) {
        dukVersion++;  // Treat e.g. 2.2.99 (built from master) as 2.3.0 for testing
    }
    return 'duktape' + (Math.floor(dukVersion / 10000)) + '_' + (Math.floor(dukVersion / 100 % 100));
})();
console.log('Duktape result key is: test.res.' + dukKey);

// List of keys for inheriting results from previous versions.
var dukKeyList = (function () {
    var res = [];
    for (var k in environments) {
        var env = environments[k];
        if (env.family !== 'Duktape') {
            continue;
        }
        res.push(k);
        if (k === dukKey) {
            // Include versions up to 'dukKey' but not newer.
            break;
        }
    }
    return res;
})();
console.log('Duktape key list for inheriting results is:', dukKeyList);

var fixTests = [];

// Run test / subtests, recursively.  Report results, indicate data files
// which are out of date.
function runTest(parents, test, sublevel) {
    var testPath = parents.join(' -> ') + ' -> ' + test.name;

    if (typeof test.exec === 'function') {
        var src = test.exec.toString();
        var m = /^function\s*\w*\s*\(.*?\)\s*\{\s*\/\*([\s\S]*?)\*\/\s*\}$/m.exec(src);
        var evalcode;
        if (m) {
            evalcode = '(function test() {' + m[1] + '})();';
        } else {
            evalcode = '(' + src + ')()';
        }
        //console.log(evalcode);

        var script = 'var evalcode = ' + JSON.stringify(evalcode) + ';\n' +
                     'try {\n' +
                     '    var res = eval(evalcode);\n' +
                     '    if (res !== true && res !== 1) { throw new Error("failed: " + res); }\n' +
                     '    console.log("[SUCCESS]");\n' +
                     '} catch (e) {\n' +
                     '    console.log("[FAILURE]", e);\n' +
                     '    /*throw e;*/\n' +
                     '}\n';

        fs.writeFileSync('duktest.js', script);
        var stdout;
        try {
            stdout = child_process.execFileSync(dukCommand, dukKey.startsWith('duktape1') ? [ 'dukconsole.js', 'duktest.js' ] : [ 'duktest.js' ], {
                encoding: 'utf-8'
            });
        } catch(e) {
            stdout = e.stdout;
        }
        //console.log(stdout);

        var success = false;
        if (/^\[SUCCESS\]$/gm.test(stdout)) {
            success = true;
            testSuccess++;
        } else {
            //console.log(stdout);
        }
        testCount++;

        if (test.res) {
            // Take expected result from newest Duktape version not newer
            // than current version.
            var expect = void 0;
            dukKeyList.forEach(function (k) {
                if (test.res[k] !== void 0) {
                    expect = test.res[k];
                }
            });

            if (expect === success) {
                // Matches.
            } else if (expect === void 0 && !success) {
                testOutOfDate++;
                console.log(testPath + ': test result missing, res: ' + expect + ', actual: ' + success);
                fixTests.push({path: testPath.split(' -> '), success: success});
            } else {
                testOutOfDate++;
                console.log(testPath + ': test result out of date, res: ' + expect + ', actual: ' + success);
                fixTests.push({path: testPath.split(' -> '), success: success});
            }
        } else {
            testOutOfDate++;
            console.log(testPath + ': test.res missing');
        }
    }
    if (test.subtests) {
        var newParents = parents.slice(0);
        newParents.push(test.name);
        test.subtests.forEach(function (v) { runTest(newParents, v, sublevel + 1); });
    }
}

fs.readdirSync('.').forEach(function (filename) {
    var m = /^(data-.*)\.js$/.exec(filename);
    if (!m) {
        return;
    }
    var suitename = m[1];

    console.log('');
    console.log('**** ' + suitename + ' ****');
    console.log('');
    var testsuite = require('./' + suitename);
    testsuite.tests.forEach(function (v) { runTest([ suitename ], v, 0); });
});

console.log(testCount + ' tests executed: ' + testSuccess + ' success, ' + (testCount - testSuccess) + ' fail');
console.log(testOutOfDate + ' tests are out of date (data-*.js file .res)');

function getIndent(str) {
    var indent = 0;
    while (str[indent] === " ") {
        indent++;
    }
    return indent;
}

function check(str, line) {
    return line.endsWith("'" + str.replace(/'/g, "\\'") + "',") ||
        line.endsWith(JSON.stringify(str) + ",") ||
        line.endsWith("'" + str.replace(/'/g, "\\'") + "': {") ||
        line.endsWith(JSON.stringify(str) + ": {");
}

console.log("Writing New Results To File...");
for (var i = 0; i < fixTests.length; i++) {
    var path = fixTests[i].path;
    var success = fixTests[i].success;
    var data = fs.readFileSync(path[0] + ".js", "utf8").split("\n");
    var k = 1;
    var done = false;
    var line = 0;

    console.log("Writing " + path.join(" -> "));

    // Find Start of Tests
    while (!data[line].startsWith("exports.tests")) {
        line++;
    }

    // Find Test
    while (!done) {
        if (check(path[k], data[line]) ||
            (path[k].startsWith("%") && check(path[k].slice(path[k].lastIndexOf("%") + 1), data[line])) ||
            check(path[k].slice(path[k].indexOf(".") + 1), data[line])) {
            k++;
        }
        if (k >= path.length) {
            done = true;
        } else {
            line++;
        }
    }

    // Find Test Results
    if (!(data[line + 1].split(" ").filter(Boolean)[0].endsWith(":") && data[line + 1].split(" ").filter(Boolean)[1].endsWith(","))) {
        while (!data[line].includes("res: {") && !data[line].includes("res : {")) {
            line++;
        }
    }

    // Get Indnets For Results Block
    var indent = getIndent(data[line]);
    var indentStr = "";
    for (var x = 0; x < indent; x++) {
        indentStr = indentStr + " ";
    }

    // Get Item Indent
    if (!data[line + 1].startsWith(indentStr + "}")) {
        var itemIndent = getIndent(data[line + 1]);
        var itemIndentStr = "";
        for (var x = 0; x < itemIndent; x++) {
            itemIndentStr = itemIndentStr + " ";
        }
    } else {
        // Assume RES Indent If None Is Found
        var itemIndentStr = indentStr + "  ";
    }

    // Find (if there) Test Result Data
    var keyExists = false;
    while (!data[line].startsWith(indentStr + "}")) {
        if (data[line].includes(dukKey)) {
            keyExists = true;
            break;
        }
        line++;
    }

    // Write Test Result
    if (keyExists) {
        data[line] = itemIndentStr + dukKey + ": " + success + ",";
    } else {
        data[line] = data[line] + "\n" + itemIndentStr + dukKey + ": " + success + ",";
    }
    fs.writeFileSync(path[0] + ".js", data.join("\n"));
}
