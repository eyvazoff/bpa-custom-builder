const watch = require("node-watch"),
    commandLineArgs = require("command-line-args"),
    fs = require("fs"),
    fse = require("fs-extra"),
    glob = require("glob"),
    htmlMinifier = require("html-minifier"),
    regexInclude = /\$\{require\([^)]*\)[^}]*\}/g,
    regexLanguage = /[$][$][^)]*[$][$]/g,
    // regexIncludeRel = /\$\{requireRel\([^)]*\)[^}]*\}/g,
    // regexIncludeFilePath = /\$\{require\((^\))+\)/g,
    regexIncludeFilePath = /\${require\(\'(.*?)\'\)/,
    regexFilesId = /\${filesId\((.*?)\)[^}]*\}/,
    regexPropAttrs = /\b([^\s]+)="[^\"]*"/gi,
    regexPropUsage = /\$\{props.[^}]+\}/g,
    maxNestedDepth = 99;

const config = require(`../../${process.env.dist}.json`);

// Grab CLI arguments
const options = [
    {name: "watch", alias: "w", type: String, multiple: true},
    {name: "src", alias: "s", type: String, defaultValue: config.source_folder},
    {name: "dest", alias: "d", type: String, defaultValue: process.env.dist},
    {name: "minify", alias: "m", type: String, multiple: true},
    {name: "quiet", alias: "q", type: String, defaultValue: false}
];
const args = commandLineArgs(options);

const randomIdent = () =>
    "xxxHTMLLINKxxx" + Math.random() + Math.random() + "xxx";

// // e.g. ("./_sub.html", "src/index.html",) => "..../src/./_sub.html"
const getFilesId = (fileRequest, fileCurrent, files) => {
    let path;
    if (fileRequest.substring(0, 1) == "/") {
        // Absolute
        path = args.src + fileRequest;
    } else {
        // Rel
        let dir = fileCurrent.split("/");
        dir.pop();
        dir = dir.join("/");
        path =
            dir +
            "/" +
            (fileRequest.substring(0, 2) == `./`
                ? fileRequest.substring(2)
                : fileRequest);
    }

    // Resolve any parent selectors, e.g:
    // src/component/../../_above.html
    // _above.html
    let split = path.split("/");
    while (split.includes("..")) {
        split.forEach((s, i) => {
            if (s === "..") {
                if (i == 0) {
                    console.error(
                        `\n SORRY: Cannot include a file above the main directory\n`
                    );
                    split.splice(i, 1); // erroring it out of the while loop
                }
                split.splice(i - 1, 2);
            }
        });
    }
    path = split.join("/");

    let filez = files.filter((f) => f.path == path);
    return filez[0] ? filez[0].id : null;
};

const compile = (args) => {
    /*let css_content = fs.readFileSync('./src/assets/css/variables.css', {encoding: 'utf-8'});
    const css_variables = config.css_variables;
    let promises = Object.keys(css_variables).map((key) => {
      css_content = css_content.replace(key, css_variables[key]);
    });
    Promise.all(promises).then((results) => {
      fse.outputFile(`./${process.env.dist}/assets/css/variables.css`, css_content, (err) => {
        if (err) {
          return console.log(err);
        }
      });
    });*/
    glob(args.src + "/**/*.html", {}, (err, files) => {
        if (err) {
            console.log(err);
            return;
        }
        if (!files) return;
        files = files.map((path, i) => {
            return {id: i, path, content: fs.readFileSync(path, "utf8")};
        });
        let noMoreJobs = false, loopCount = 0;
        while (!noMoreJobs && loopCount < maxNestedDepth) {
            noMoreJobs = true; // hopeful
            files = files.map((file) => {

                file.content = file.content.replace(/PARTNER_COUNT/g, process.env.partner_count);
                if (file.content.match(regexInclude)) {
                    noMoreJobs = false;
                    file.content = file.content.replace(regexInclude, (require) => {
                        let requirePath = require.match(regexIncludeFilePath)[1],
                            filesId = getFilesId(requirePath, file.path, files);
                        let propsAttrs = require.match(regexPropAttrs);
                        if (filesId === null) {
                            console.error(
                                `\n FILE MISSING: ${requirePath} (requested by ${file.path})\n`
                            );
                        }
                        let hfor = false;
                        let hfor_count = 0;
                        if (propsAttrs && propsAttrs.length > 0) {
                            Promise.all(
                                propsAttrs.map(key => {
                                    if (key.search("hfor") !== -1) {
                                        hfor = true;
                                        hfor_count = key.split("=")[1].replace(/"/g, "");
                                    }
                                })
                            );
                        }

                        if (hfor) {
                            let html = '';
                            for (let i = 0; i < parseInt(hfor_count); i++) {
                                html += (
                                    "${filesId(" +
                                    filesId +
                                    ")" +
                                    (propsAttrs ? " " + propsAttrs.join(" ") : "") +
                                    ` number="${i + 1}"}`
                                );
                            }
                            return html;
                        } else {
                            return (
                                "${filesId(" +
                                filesId +
                                ")" +
                                (propsAttrs ? " " + propsAttrs.join(" ") : "") +
                                "}"
                            );
                        }
                    });
                }
                return file;
            });
            loopCount++;
        }
        noMoreJobs = false;
        loopCount = 0;
        while (!noMoreJobs && loopCount < maxNestedDepth) {
            noMoreJobs = true;
            files = files.map((file) => {
                if (file.content.match(regexFilesId)) {
                    noMoreJobs = false;
                    file.content = file.content.replace(regexFilesId, (require) => {
                        let filesId = require.match(regexFilesId)[1];
                        let _file = files.filter((f) => f.id == filesId)[0];
                        if (!_file) return;
                        let filesContent = _file.content;
                        let propsAttrs = require.match(regexPropAttrs);
                        if (propsAttrs) {
                            let props = [];
                            propsAttrs.forEach((prop) => {
                                let pair = prop.split("=");
                                props[pair[0]] = pair[1].substring(1, pair[1].length - 1);
                            });
                            filesContent = filesContent.replace(regexPropUsage, (match) => {
                                let propKey = match.substring(
                                    "${props.".length,
                                    match.length - "}".length
                                );
                                return props[propKey] ? props[propKey] : "";
                            });
                        }

                        return filesContent;
                    });
                }
                return file;
            });
            loopCount++;
        }
        let minimizeOptions = false;
        if (typeof args.minify != "undefined") {
            minimizeOptions = {
                removeComments: true,
                removeCommentsFromCDATA: true,
                removeCDATASectionsFromCDATA: true,
                collapseWhitespace: true,
                conservativeCollapse: false,
                removeAttributeQuotes: false,
                useShortDoctype: true,
                keepClosingSlash: true,
                minifyJS: false,
                minifyCSS: true,
                removeScriptTypeAttributes: true,
                removeStyleTypeAttribute: true,
            };
            if (args.minify && args.minify.length) {
                args.minify.forEach((arg) => {
                    arg = arg.split("=");
                    minimizeOptions[arg[0]] = arg[1] == "false" ? false : true;
                });
            }
        }
        let json = [];
        files.forEach(async (file) => {
            let filename = file.path.split("/");
            filename = filename[filename.length - 1];
            if (filename.substring(0, 1) !== "_") {
                let filename = file.path.substring(args.src.length);
                let outputFilePath = args.dest + filename;
                if (args.quiet === false) {
                    console.log("Saving: " + file.path + "-> " + outputFilePath);
                }
                file.content = file.content.replace(/###/g, process.env.content_type);
                file.content = minimizeOptions ? htmlMinifier.minify(file.content, minimizeOptions) : file.content;
                let multi_page = filename.split("___");
                if (multi_page && multi_page.length > 0 && multi_page.length === 3) {
                    let page_numbers = multi_page[1].split(",");
                    await Promise.all(
                        page_numbers.map(async (key, index) => {
                            file.content = await file.content.replace(/@@@/g, index + 1);
                            let content_only_body = await file.content.split("<!--body-mark-->");
                            await fse.outputFile(`${args.dest}/nr${key}_${multi_page[2]}`, file.content, (err) => {
                                if (err) {
                                    return console.log(err);
                                } else {
                                    json.push({
                                        pageNr: key,
                                        pagePart: 0,
                                        status: 1,
                                        contentType: parseInt(process.env.content_type),
                                        value: content_only_body[1]
                                    })
                                    fse.outputFile(`${args.dest}/deploy/nr${key}_${multi_page[2]}`, content_only_body[1], err => console.log(err));
                                }
                            });
                        })
                    )
                } else {
                    fse.outputFile(outputFilePath, file.content, err => console.log(err));
                    let content_only_body = file.content.split("<!--body-mark-->");
                    fse.outputFile(`${args.dest}/deploy/${filename}`, content_only_body[1], err => console.log(err));
                    json.push({
                        pageNr: parseInt(filename.split("_")[0].replace("/nr", "")),
                        pagePart: 0,
                        status: 1,
                        contentType: parseInt(process.env.content_type),
                        value: content_only_body[1]
                    })
                }
            }
        });
        fse.outputFile(`${args.dest}/111_deploy.json`, JSON.stringify(json), err => console.log('JSON yaradilmasinda "problem" yashanib'));
    });
};


// Run on init
compile(args);

// Watch for changes with flag of --watch
if (typeof args.watch != "undefined") {
    if (args.watch == null || !args.watch.length) args.watch = args.src;
    watch(
        args.watch,
        {
            recursive: true,
            // filter: /\.html$/
        },
        function (evnt, file) {
            if (evnt === "update") {
                compile(args);
            }
        }
    );
}
