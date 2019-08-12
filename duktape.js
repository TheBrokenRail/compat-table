/*
 *  Node.js test runner for running data-*.js tests with Duktape 'duk' command.
 *
 *  Reports discrepancies to console; fix them manually in data-*.js files.
 *  Expects a './duk' command in the current directory.  Example:
 *
 *    $ cp /path/to/duk ./duk
 *    $ node duktape.js
 */

var fs = require('fs');
var child_process = require('child_process');

var testCount = 0;
var testSuccess = 0;

var dukCommand = './duk';

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
        var stdout = child_process.execFileSync(dukCommand, [ 'duktest.js' ], {
            encoding: 'utf-8'
        });
        //console.log(stdout);

        var success = false;
        if (/^\[SUCCESS\]$/gm.test(stdout)) {
            success = true;
            testSuccess++;
        } else {
            //console.log(stdout);
        }
        testCount++;

        // Take expected result from newest Duktape version not newer
        // than current version.

        if (success) {
            console.log(testPath + ': test passed');
        } else {
            console.log(testPath + ': test failed');
        }
        test.success = success;
    }
    if (test.subtests) {
        var newParents = parents.slice(0);
        newParents.push(test.name);
        test.subtests.forEach(function (v) { runTest(newParents, v, sublevel + 1); });
    }
}

function setResults(test, results) {
    var resTest;
    var i;
    for (i = 0; i < results.length; i++) {
        if (results[i].name === test.name) {
            resTest = results[i];
            break;
        }
    }
    if (!resTest) {
        throw new Error('Unable to find test in results JSON');
    }
    if (resTest.res) {
        resTest.res[dukKey] = test.success;
    }
    if (test.subtests) {
        if (!resTest.subtests) {
            throw new Error('Test has subtests, but results don\'t');
        }
        for (i = 0; i < test.subtests.length; i++) {
            setResults(test.subtests[i], resTest.subtests);
        }
    }
}

fs.readdirSync('.').forEach(function (filename) {
    var m = /^(data-.*)\-tests.js$/.exec(filename);
    if (!m) {
        return;
    }
    var suitename = m[1];

    console.log('');
    console.log('**** ' + suitename + ' ****');
    console.log('');
    var testsuite = require('./' + suitename + '-tests');
    testsuite.forEach(function (v) { runTest([ suitename ], v, 0); });
    
    var results = require('./' + suitename);
    for (var i = 0; i < testsuite.length; i++) {
        setResults(testsuite[i], results.tests);
    }
    fs.writeFileSync(suitename + '.json', JSON.stringify(results, null, 4));
});

console.log(testCount + ' tests executed: ' + testSuccess + ' success, ' + (testCount - testSuccess) + ' fail');
