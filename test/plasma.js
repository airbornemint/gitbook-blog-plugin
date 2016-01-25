var plasma = require('../index.js');
var should = require("should");

describe('Plasma', function() {
    describe('blogStructure', function() {
        it('trivial', function() {
            var files = [
            ];
            var tree = plasma.blogStructure(null, files);
            tree.should.eql({
                pages: {
                },
                site: {
                    author: {
                    },
                    title: "",
                    server: "",
                    categories: {
                    }
                },
                taxonomy: {
                    tags: {
                    },
                    categories: {
                    }
                }, feeds: {
                }
            });
        });
    });
});
