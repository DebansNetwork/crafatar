var assert = require("assert");
var fs = require("fs");

var networking = require("../modules/networking");
var helpers = require("../modules/helpers");
var logging = require("../modules/logging");
var config = require("../modules/config");
var skins = require("../modules/skins");
var cache = require("../modules/cache");
var renders = require("../modules/renders");
var cleaner = require("../modules/cleaner");

// we don't want tests to fail because of slow internet
config.http_timeout *= 3;

// no spam
logging.log = function() {};

var uuids = fs.readFileSync("test/uuids.txt").toString().split(/\r?\n/);
var names = fs.readFileSync("test/usernames.txt").toString().split(/\r?\n/);

// Get a random UUID + name in order to prevent rate limiting
var uuid = uuids[Math.round(Math.random() * (uuids.length - 1))];
var name = names[Math.round(Math.random() * (names.length - 1))];

var rid = "TestReqID: ";

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

var ids = [
  uuid.toLowerCase(),
  name.toLowerCase(),
  uuid.toUpperCase(),
  name.toUpperCase()
];

describe("Crafatar", function() {
  // we might have to make 2 HTTP requests
  this.timeout(config.http_timeout * 2 + 50);

  before(function() {
    cache.get_redis().flushall();
    cleaner.run();
  });

  describe("UUID/username", function() {
    it("non-hex uuid is invalid", function(done) {
      assert.strictEqual(helpers.id_valid("g098cb60fa8e427cb299793cbd302c9a"), false);
      done();
    });
    it("empty id is invalid", function(done) {
      assert.strictEqual(helpers.id_valid(""), false);
      done();
    });
    it("non-alphanumeric username is invalid", function(done) {
      assert.strictEqual(helpers.id_valid("usernäme"), false);
      done();
    });
    it("dashed username is invalid", function(done) {
      assert.strictEqual(helpers.id_valid("user-name"), false);
      done();
    });
    it(">16 length username is invalid", function(done) {
      assert.strictEqual(helpers.id_valid("ThisNameIsTooLong"), false);
      done();
    });
    it("lowercase uuid is valid", function(done) {
      assert.strictEqual(helpers.id_valid("0098cb60fa8e427cb299793cbd302c9a"), true);
      done();
    });
    it("uppercase uuid is valid", function(done) {
      assert.strictEqual(helpers.id_valid("1DCEF164FF0A47F2B9A691385C774EE7"), true);
      done();
    });
    it("dashed uuid is valid", function(done) {
      assert.strictEqual(helpers.id_valid("0098cb60-fa8e-427c-b299-793cbd302c9a"), true);
      done();
    });
    it("16 chars, underscored, capital, numbered username is valid", function(done) {
      assert.strictEqual(helpers.id_valid("__niceUs3rname__"), true);
      done();
    });
    it("1 char username is valid", function(done) {
      assert.strictEqual(helpers.id_valid("a"), true);
      done();
    });
    it("should not exist (uuid)", function(done) {
      var number = getRandomInt(0, 9).toString();
      networking.get_profile(rid, Array(33).join(number), function(err, profile) {
        assert.strictEqual(profile, null);
        done();
      });
    });
    it("should not exist (username)", function(done) {
      networking.get_username_url(rid, "Steve", 0, function(err, profile) {
        assert.strictEqual(err, null);
        done();
      });
    });
  });

  describe("Avatar", function() {
    // profile "Alex" - hoping it'll never have a skin
    var alex_uuid = "ec561538f3fd461daff5086b22154bce";
    // profile "Steven" (Steve doesn't exist) - hoping it'll never have a skin
    var steven_uuid = "b8ffc3d37dbf48278f69475f6690aabd";

    it("uuid's account should exist, but skin should not", function(done) {
      networking.get_profile(rid, alex_uuid, function(err, profile) {
        assert.notStrictEqual(profile, null);
        networking.get_uuid_url(profile, 1, function(url) {
          assert.strictEqual(url, null);
          done();
        });
      });
    });
    it("odd UUID should default to Alex", function(done) {
      assert.strictEqual(skins.default_skin(alex_uuid), "alex");
      done();
    });
    it("even UUID should default to Steve", function(done) {
      assert.strictEqual(skins.default_skin(steven_uuid), "steve");
      done();
    });
  });
  describe("Errors", function() {
    it("should time out on uuid info download", function(done) {
      var original_timeout = config.http_timeout;
      config.http_timeout = 1;
      networking.get_profile(rid, "069a79f444e94726a5befca90e38aaf5", function(err, profile) {
        assert.strictEqual(err.code, "ETIMEDOUT");
        config.http_timeout = original_timeout;
        done();
      });
    });
    it("should time out on username info download", function(done) {
      var original_timeout = config.http_timeout;
      config.http_timeout = 1;
      networking.get_username_url(rid, "jomo", 0, function(err, url) {
        assert.strictEqual(err.code, "ETIMEDOUT");
        config.http_timeout = original_timeout;
        done();
      });
    });
    it("should time out on skin download", function(done) {
      var original_timeout = config.http_timeout;
      config.http_timeout = 1;
      networking.get_from(rid, "http://textures.minecraft.net/texture/477be35554684c28bdeee4cf11c591d3c88afb77e0b98da893fd7bc318c65184", function(body, res, error) {
        assert.strictEqual(error.code, "ETIMEDOUT");
        config.http_timeout = original_timeout;
        done();
      });
    });
    it("should not find the skin", function(done) {
      assert.doesNotThrow(function() {
        networking.get_from(rid, "http://textures.minecraft.net/texture/this-does-not-exist", function(img, response, err) {
          assert.strictEqual(err, null); // no error here, but it shouldn't throw exceptions
          done();
        });
      });
    });
    it("should ignore file updates on invalid files", function(done) {
      assert.doesNotThrow(function() {
        cache.update_timestamp(rid, "0123456789abcdef0123456789abcdef", "invalid-file.png");
      });
      done();
    });
    it("should not find the file", function(done) {
      skins.open_skin(rid, 'non/existant/path', function(err, img) {
        assert.notStrictEqual(err, null);
        done();
      });
    });
  });

  // we have to make sure that we test both a 32x64 and 64x64 skin
  describe("Networking: Render", function() {
    it("should not fail (username, 32x64 skin)", function(done) {
      helpers.get_render(rid, "md_5", 6, true, true, function(err, hash, img) {
        assert.strictEqual(err, null);
        done();
      });
    });
    it("should not fail (username, 64x64 skin)", function(done) {
      helpers.get_render(rid, "Jake0oo0", 6, true, true, function(err, hash, img) {
        assert.strictEqual(err, null);
        done();
      });
    });
  });

  describe("Networking: Cape", function() {
    it("should not fail (guaranteed cape)", function(done) {
      helpers.get_cape(rid, "Dinnerbone", function(err, hash, img) {
        assert.strictEqual(err, null);
        done();
      });
    });
    it("should already exist", function(done) {
      before(function() {
        cache.get_redis().flushall();
      });
      helpers.get_cape(rid, "Dinnerbone", function(err, hash, img) {
        assert.strictEqual(err, null);
        done();
      });
    });
    it("should not be found", function(done) {
      helpers.get_cape(rid, "Jake0oo0", function(err, hash, img) {
        assert.strictEqual(img, null);
        done();
      });
    });
  });

  describe("Networking: Skin", function() {
    it("should not fail", function(done) {
      helpers.get_cape(rid, "Jake0oo0", function(err, hash, img) {
        assert.strictEqual(err, null);
        done();
      });
    });
    it("should already exist", function(done) {
      before(function() {
        cache.get_redis().flushall();
      });
      helpers.get_cape(rid, "Jake0oo0", function(err, hash, img) {
        assert.strictEqual(err, null);
        done();
      });
    });
  });


  // DRY with uuid and username tests
  for (var i in ids) {
    var id = ids[i];
    var id_type = id.length > 16 ? "uuid" : "name";
    // needs an anonymous function because id and id_type aren't constant
    (function(id, id_type) {
      describe("Networking: Avatar", function() {
        before(function() {
          cache.get_redis().flushall();
          console.log("\n\nRunning tests with " + id_type + " '" + id + "'\n\n");
        });

        it("should be downloaded", function(done) {
          helpers.get_avatar(rid, id, false, 160, function(err, status, image) {
            assert.strictEqual(status, 2);
            done();
          });
        });
        it("should be cached", function(done) {
          helpers.get_avatar(rid, id, false, 160, function(err, status, image) {
            assert.strictEqual(status === 0 || status === 1, true);
            done();
          });
        });
        if (id.length > 16) {
          console.log("can't run 'checked' test due to Mojang's rate limits :(");
        } else {
          it("should be checked", function(done) {
            var original_cache_time = config.local_cache_time;
            config.local_cache_time = 0;
            helpers.get_avatar(rid, id, false, 160, function(err, status, image) {
              assert.strictEqual(status, 3);
              config.local_cache_time = original_cache_time;
              done();
            });
          });
        }
      });

      describe("Networking: Skin", function() {
        it("should not fail (uuid)", function(done) {
          helpers.get_skin(rid, id, function(err, hash, img) {
            assert.strictEqual(err, null);
            done();
          });
        });
      });

      describe("Networking: Render", function() {
        it("should not fail (full body)", function(done) {
          helpers.get_render(rid, id, 6, true, true, function(err, hash, img) {
            assert.strictEqual(err, null);
            done();
          });
        });
        it("should not fail (only head)", function(done) {
          helpers.get_render(rid, id, 6, true, false, function(err, hash, img) {
            assert.strictEqual(err, null);
            done();
          });
        });
      });

      describe("Networking: Cape", function() {
        it("should not fail (possible cape)", function(done) {
          helpers.get_cape(rid, id, function(err, hash, img) {
            assert.strictEqual(err, null);
            done();
          });
        });
      });


      describe("Errors", function() {
        before(function() {
          cache.get_redis().flushall();
        });

        if (id_type == "uuid") {
          it("uuid should be rate limited", function(done) {
            networking.get_profile(rid, id, function(err, profile) {
              assert.strictEqual(profile.error, "TooManyRequestsException");
              done();
            });
          });
        } else {
          it("username should NOT be rate limited (username)", function(done) {
            helpers.get_avatar(rid, id, false, 160, function(err, status, image) {
              assert.strictEqual(err, null);
              done();
            });
          });
        }
      });
    })(id, id_type);
  }
});