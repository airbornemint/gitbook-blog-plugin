var _ = require('lodash');
var Q = require('q');
var frontMatter = require("front-matter");
var path = require("path");
var fs = require("fs-extra");
var parsers = require('gitbook-parsers');
var extend = require('extend');
var cheerio = require('cheerio');
var domSerializer = require('dom-serializer');
var url = require('url');
var strftime = require('strftime');
var sprintf = require('sprintf-js').sprintf;
var jimp = require("jimp");
var highlight = require("highlight.js");

// Skanktastic
var generators = require(path.join(path.dirname(require.resolve("gitbook")), "generators"));
var gitbookfs = require(path.join(path.dirname(require.resolve("gitbook")), "utils/fs"));

function blogStructure(book, files) {
    var options = book ? book.options.pluginsConfig.plasma : {
        tags: {},
        categories: {},
        title: "",
        author: {},
        server: "",
        feeds: {}
    }
    
    var blog = {
        // Index of pages by path
        pages: {
        },
        taxonomy: {
            // Index of tags (by name)
            tags: {
            },
            // Index of categories (by slug)
            categories: {
            }
        },
        site: {
            author: options.author,
            title: options.title,
            server: options.server
        },
        feeds: _.clone(options.feeds)
    }
    
    var tagDefaults = options.tags;
    var catDefaults = options.categories;
    
    _.each(files, function(f) {
        if (_.includes(parsers.extensions, path.extname(f))) {
            var pagePublishPath = path.dirname(contentPath(f));
            var pathComponents = pagePublishPath.split(path.sep);
            
            var catPath = pathComponents.slice(0, pathComponents.length - 1).join(path.sep);
            var catName = path.basename(catPath);
            var pageName = pathComponents[pathComponents.length - 1];
            
            // Extract frontMatter if found
            var content = book ? fs.readFileSync(book.resolve(f), { encoding: 'utf8' }) : null;
            var frontmatter = content && frontMatter.test(content) ? frontMatter(content).attributes : {};
            
            // This is the default metadata for a page
            var defaults = {
                title: pageName,
                draft: false,
                publish: true,
                tags: []
            };

            // These are page properties that cannot be overridden by frontmatter
            var pageInfo = {
                slug: pageName,
                path: f,
                url: "/" + pagePublishPath
            };

            // Read frontmatter, fall back on defaults, and add a dash of page info
            pageInfo = _.extend(defaults, frontmatter, pageInfo);

            // Ignore draft pages
            if (!pageInfo.draft && pageInfo.publish) {
                // Create the category if needed
                if (!(catPath in blog.taxonomy.categories)) {
                    blog.taxonomy.categories[catPath] = _.extend({
                        name: catName
                    }, catDefaults[catPath], {
                        slug: catName,
                        related: [],
                        path: catPath,
                        url: "/" + catPath,
                        pages: []
                    });
                }
                
                var catInfo = blog.taxonomy.categories[catPath];
                catInfo.pages.push(pageInfo);
                pageInfo.category = catInfo;

                // Create tags as needed
                var pageTags = pageInfo.tags;
                pageInfo.tags = []
                _.each(pageTags, function(tag) {
                    if (!(tag in blog.taxonomy.tags)) {
                        blog.taxonomy.tags[tag] = _.extend({}, tagDefaults[tag], {
                            "title": tag,
                            "related": [],
                            "pages": []
                        });
                        blog.taxonomy.tags[tag].url = "/" + blog.taxonomy.tags[tag].slug;
                    }
                    
                    var tagInfo = blog.taxonomy.tags[tag];
                    tagInfo.pages.push(pageInfo);
                    pageInfo.tags.push(tagInfo);

                    // Connect tags and category through related
                    tagInfo.related.push(catInfo);
                    tagInfo.related = _.uniq(tagInfo.related);
                    
                    catInfo.related.push(blog.taxonomy.tags[tag]);
                    catInfo.related = _.uniq(catInfo.related);
                });
                
                blog.pages[f] = pageInfo;
            }
        }
    });

    _.each(blog.taxonomy.tags, function(tag) {
        tag.pages.sort(pageCompare);
    });
    
    _.each(blog.taxonomy.categories, function(category) {
        if (category.slug != "") {
            category.pages.sort(pageCompare);
        }
    });
    
    _.each(blog.feeds, function(feed, type) {
        var feedInfo = {
            url: feed,
            pages: _.filter(blog.pages, function(page) {
                return !_.isUndefined(page.date);
            }),
            date: new Date(Date.now())
        };
        
        feedInfo.pages.sort(pageCompare);
        
        blog.feeds[type] = feedInfo;
    });
    
    blog.site.categories = blog.taxonomy.categories;
    
    return blog;
}

function pageCompare(page1, page2) {
    return page2.date.valueOf() - page1.date.valueOf();
}

function categoryCompare(cat1, cat2) {
    return cat1.name.localeCompare(cat2.name);
}

function tagCompare(tag1, tag2) {
    return tag1.name.localeCompare(tag2.name);
}

function contentPath(link) {
    // Decide where to render the page
    var ext = path.extname(link);
    var name = path.basename(link, ext);
    var parent = path.dirname(link);
    var parentExt = path.extname(parent);
    var parentName = path.basename(parent, parentExt);
    
    if (name != "index") {
        if (name == parentName) {
            link = path.join(parent, "index" + ext);
        } else {
            link = path.join(parent, name, "index" + ext);
        }
    }

    return link
}

function blogNavigation(blog) {
    var navigation = {};
    var index = 1;
    _.each(blog.taxonomy.categories, function(category) {
        addCategoryToNavigation(category, navigation, index);
        index += 1;
    });
    return navigation;
}

function addCategoryToNavigation(category, navigation, index) {
    var i = 1;
    _.each(category.pages, function(page) {
        var pageNavigation = {
            introduction: false,
            level: [index, i].join("."),
            index: i,
            title: page.title
        };
        navigation[page.path] = pageNavigation;
        i += 1;
    });
}

function blogSummary(blog) {
    var summary = {
        "chapters": []
    };
    var index = 1;
    _.each(blog.taxonomy.categories, function(category) {
        addCategoryToSummary(category, summary.chapters, index);
        index += 1;
    });
    return summary;
}

function addCategoryToSummary(category, summary, index) {
    var i = 1;
    _.each(category.pages, function(page) {
        var pageSummary = {
            "articles": [],
            exists: true,
            external: false,
            introduction: false,
            path: page.path,
            level: [index, i].join("."),
            title: page.title
        };
        summary.push(pageSummary);
        i += 1;
    });
}

function templateContentAdditions(book, content) {
    var renderState = book._plugin_plasma_render_state;
    return {
        functions: {
            strftime: function(date, format) {
                return strftime(format, date);
            },
            
            imageFit: function(image, w, h) {
                var ext = path.extname(image);
                var name = path.basename(image, ext);
                var dir = path.dirname(image);
                name = sprintf("%s-fit-%d-%d%s", name, w, h, ext);
                renderState.images.push({
                    transform: "fit",
                    base: content.path,
                    original: image,
                    derived: name,
                    width: w,
                    height: h
                });
                return path.join(dir, name);
            },

            imageFill: function(image, w, h) {
                var ext = path.extname(image);
                var name = path.basename(image, ext);
                var dir = path.dirname(image);
                name = sprintf("%s-fill-%d-%d%s", name, w, h, ext);
                renderState.images.push({
                    transform: "fill",
                    base: content.path,
                    original: image,
                    derived: name,
                    width: w,
                    height: h
                });
                return path.join(dir, name);
            }
        }
    };
}

function renderThemeTemplate(book, template, output, content) {
    var Generator = generators[book.options.generator];
    var generator = new Generator(book);

    var ext = path.extname(output);
    var relativeOutput;
    // Book.contentPath breaks filenames that don't generate HTML (such as feeds)
    if (_.includes(parsers.extensions, ext)) {
        relativeOutput = book.contentPath(output);
    } else {
        relativeOutput = output;
    }
    var output = path.join(book.options.output, relativeOutput);

    var basePath = path.relative(path.dirname(output), book.options.output) || '.';
    if (process.platform === 'win32') basePath = basePath.replace(/\\/g, '/');

    book.log.info.ln('generating', relativeOutput);

    // Make sure that the parent directory exists
    fs.mkdirpSync(path.dirname(output));

    return generator.prepare()
    .then(function() {
        return generator._writeTemplate(template, _.extend({}, content, {
            basePath: basePath,
            staticBase: path.join(basePath, 'gitbook')
        }), output)
    });
}

module.exports = {
    // Extend website resources and html
    website: {
        assets: "./book",
        js: [
        ],
        css: [
        ],
        html: {
        }
    },

    // Extend templating blocks
    blocks: {
        // Because the built-in is broken and generates unescaped garbage if code block contains <
        code: {
            process: function(block) {
                return {
                    html: false,
                    body: block.body
                }
            }
        }
    },

    // Extend templating filters
    filters: {
    },
    
    // Hook process during build
    hooks: {
        // For all the hooks, this represent the current generator

        // This is called before the book is generated
        "init": function() {
            var that = this;

            if (!that.hasOwnProperty("_plugin_plasma_inited")) {
                return Q()
                    .then(function() {

                        // Swizzle in override for Book.contentPath (adjusts paths from foo.html to foo/index.html)
                        that._plugin_plasma_original_contentPath = that.contentPath;
                        that.contentPath = function(link) {
                            var p = contentPath(this._plugin_plasma_original_contentPath(link));

                            // Make sure that the parent directory exists
                            var destDir = path.dirname(path.join(this.config.options.output, p));
                            fs.mkdirpSync(destDir);

                            return p;
                        };
            
                        // Swizzle in override for Book.contentLink
                        that._plugin_plasma_original_contentLink = that.contentLink;
                        that.contentLink = function(link) {
                            var newLink = this._plugin_plasma_original_contentLink(link);
                            if (path.basename(newLink) == "index.html") {
                                return path.dirname(newLink);
                            } else {
                                return newLink;
                            }
                        };
                
                        // Swizzle in override for Book.listAllFiles to leave PDFs and eBooks in the output
                        that._plugin_plasma_original_listAllFiles = that.listAllFiles;
                        that.listAllFiles = function() {
                            var that = this;

                            return gitbookfs.list(this.root, {
                                ignoreFiles: ['.ignore', '.gitignore', '.bookignore'],
                                ignoreRules: [
                                    // Skip Git stuff
                                    '.git/',
                                    '.gitignore',

                                    // Skip OS X meta data
                                    '.DS_Store',

                                    // Skip stuff installed by plugins
                                    'node_modules',

                                    // Skip book outputs
                                    '_book',

                                    // Skip config files
                                    '.ignore',
                                    '.bookignore',
                                    'book.json',
                                ]
                            })
                            .then(function(_files) {
                                that.files = _files;
                            });
                        };
                    }).then(function() {
                        return that.listAllFiles();
                    }).then(function() {
                        // Parse the blog page structure and taxonomy
                        that._plugin_plasma_blog = blogStructure(that, that.files);
                        that._plugin_plasma_render_state = {
                            images: []
                        };
        
                        // Replace navigation with bloggy navigation
                        that.navigation = blogNavigation(that._plugin_plasma_blog);
                        that.summary = blogSummary(that._plugin_plasma_blog);

                        that._plugin_plasma_inited = true;
                    });
            }
        },

        "config": function(config) {
            return config;
        },

        "page": function(page) {
            console.log("Generating %j", page.path);
            // At this point, HTML for page content has been assembled, but since we changed the location of some files, we may need to adjust some links
            var that = this;

            var src = path.dirname(page.path);
            var dst = path.dirname(that.contentPath(page.path));
            
            if (src != dst) {
                _.each(page.sections, function(section) {
                    if (section.type == "normal") {
                        var $ = cheerio.load(section.content, {
                            // We should parse html without trying to normalize too much
                            xmlMode: false,

                            // SVG need some attributes to use uppercases
                            lowerCaseAttributeNames: false,
                            lowerCaseTags: false
                        });
                        
                        $('img').each(function() {
                            var src = $(this).attr('src');
                            if (!src) return;

                            if (isRelative(src)) {
                                $(this).attr('src', "../" + src);
                            }
                        });

                        $('a').each(function() {
                            var href = $(this).attr('href');
                            if (!href) return;

                            if (isRelative(href)) {
                                $(this).attr('href', "../" + href);
                            }
                            
                            if ($(this).attr('target') == "_blank") {
                                $(this).removeAttr('target');
                            }
                        });
                        
                        $('pre code').each(function(index, block) {
                            var lang = _.chain(
                                    ($(this).attr('class') || '').split(' ')
                                )
                                .map(function(cl) {
                                    // Markdown
                                    if (cl.search('lang-') === 0) return cl.slice('lang-'.length);

                                    // Asciidoc
                                    if (cl.search('language-') === 0) return cl.slice('language-'.length);

                                    return null;
                                })
                                .compact()
                                .first()
                                .value();

                            if (_.isUndefined(lang)) {
                                return {
                                    html: true,
                                    body: highlight.highlightAuto($(this).text()).value
                                }
                            } else {
                                return {
                                    html: true,
                                    body: highlight.highlight(lang, $(this).text(), true).value
                                }
                            }
                        });
                        
                        section.content = renderDom($)
                    }
                })
            }
            
            var pageContent = that._plugin_plasma_blog.pages[page.path];
            
            page.sections = _.extend(page.sections, {
                this: pageContent,
                site: that._plugin_plasma_blog.site
            }, templateContentAdditions(that, pageContent));
            
            page.sections.this.content = _.map(page.sections, function(section) {
                return section.content;
            }).join("\n");
            
            return page;
        },

        "page:before": function(page) {
            // Extract frontmatter if found
            if (frontMatter.test(page.content)) {
                var fm = frontMatter(page.content);
                page.content = fm.body;
            }

            return page;
        },

        "finish:before": function() {
            var that = this;
            
            // Website content has been generated. Let's generate category and tag indices
            return Q()
            .then(function() {
                that.log.info.ln('generating indices');
                return Q.all(
                    _.map(that._plugin_plasma_blog.taxonomy.categories, function(category) {
                        if (category.slug != "") {
                            that.log.info.ln('category index for', category.slug, 'with', that.options.generator, 'generator');
                        
                            return renderThemeTemplate(that, "category.html", path.join(category.slug, "index.html"), {
                                content: _.extend({
                                    site: that._plugin_plasma_blog.site,
                                    this: category
                                }, templateContentAdditions(that, category))
                            });
                        }
                    })
                );
            })
            .then(function() {
                return Q.all(
                    _.map(that._plugin_plasma_blog.taxonomy.tags, function(tag) {
                        that.log.info.ln('tag index for', tag.name, 'with', that.options.generator, 'generator');

                        return renderThemeTemplate(that, "tag.html", path.join(tag.slug, "index.html"), {
                            content: _.extend({
                                site: that._plugin_plasma_blog.site,
                                this: tag
                            }, templateContentAdditions(that, tag))
                        });
                    })
                );
            })
            .then(function() {
                that.log.info.ln('generating feeds');
                return Q.all(
                    _.map(that._plugin_plasma_blog.feeds, function(feed, type) {
                        that.log.info.ln(type, 'feed', feed.url, 'with', that.options.generator, 'generator');

                        return renderThemeTemplate(that, type + ".xml", feed.url, {
                            content: _.extend({
                                site: that._plugin_plasma_blog.site,
                                this: feed
                            }, templateContentAdditions(that, feed))
                        });
                    })
                )
            }).then(function() {
                that.log.info.ln('generating images');
                return Q.all(
                    _.map(that._plugin_plasma_render_state.images, function(imageTransform) {
                        var base = path.dirname(that.contentPath(imageTransform.base));
                        var original = path.join(base, imageTransform.original);
                        var derived = path.join(base, imageTransform.derived);
                        that.log.info.ln('generating', derived);
                        
                        original = path.join(that.options.output, original);
                        derived = path.join(that.options.output, derived);
                        
                        return jimp.read(original)
                            .then(function(image) {
                                if (imageTransform.transform == "fit") {
                                    return image.contain(imageTransform.width, imageTransform.height);
                                } else if (imageTransform.transform == "fill") {
                                    return image.cover(imageTransform.width, imageTransform.height);
                                } else {
                                    return image;
                                }
                            }).then(function(image) {
                                return image.write(derived);
                            });
                    })
                );
            });
        },

        "finish": function() {
            this.log.info.ln('done');
        }
    },
    
    // Export these for unit testing
    blogStructure: blogStructure
};

// Assorted utilities snagged from elsewhere
var isRelative = function(href) {
    try {
        var parsed = url.parse(href);

        return !!(!parsed.protocol && parsed.path);
    } catch(err) {}

    return true;
};

function renderDom($, dom, options) {
    if (!dom && $._root && $._root.children) {
        dom = $._root.children;
    }

    options = options|| dom.options || $._options;
    return domSerializer(dom, options);
}
