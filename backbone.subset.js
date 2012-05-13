/**
 * @class  Backbone.Subset
 * @name   Backbone Subset collections
 * @desc   Implements a collection that is a subset other Backbone Collections
*/
(function () {

  var root = this
    , Subset = {}
    , _ = root._;

  if (!_ && (typeof require !== 'undefined')) {
    _ = require('underscore')._;
  }

  /**
   * Returns the xor of two sets
   *
   * @param {Array} a
   * @param {Array} b
   * @return {Array}
   */
  function xor(a, b) {
    return _.difference(_.union(a, b), _.intersection(a, b));
  }

  /**
   * Subset constructor
   *
   * @param {String|Object} type
   * @param {Number} id
   * @return {Object}
   */
  Backbone.Subset = function Subset(models, options) {
    options = options || {};

    this.model = this.parent().model;
    this.comparator = this.comparator || options.comparator || this.parent().comparator;
    this.liveupdate_keys = this.liveupdate_keys || options.liveupdate_keys;

    _.bindAll(this, '_onModelEvent', '_unbindModelEvents', '_proxyAdd'
              , '_proxyReset', '_proxyRemove', '_proxyChange');

    this.parent().bind('add', this._proxyAdd);
    this.parent().bind('remove', this._proxyRemove);
    this.parent().bind('reset', this._proxyReset);
    this.parent().bind('all', this._proxyChange);

    if (this.beforeInitialize) {
      this.beforeInitialize.apply(this, arguments);
    }

    if (!options.no_reset) {
      this._reset();
      this.reset(models || this.parent().models, {silent: true});
    } else {
      this._resetSubset({silent: true});
    }

    this.initialize.apply(this, arguments);
  };

  /**
   * Resets the parent collection
   *
   * @param {Object} models
   * @param {Object} options
   * @return {Object} collection
   */
  Subset.reset = function (models, options) {
    var parent_models = _.clone(this.parent().models)
      , xored_ids
      , ids = this.pluck('id');

    models = models || [];
    models = _.isArray(models) ? models : [models];
    options = options || {};

    // delete parent reseted models
    parent_models = _.reject(parent_models, function (model) {
      return _.include(ids, model.id);
    });

    // insert parent reseted models
    _.each(models, function (model) {
      parent_models.push(model);
    });

    // xored ids are the ones added/removed
    xored_ids = xor(ids, _.pluck(models, 'id'));

    this.parent().reset(parent_models, _.extend({silent: true}, options));
    this.parent().trigger('reset', this, _.extend({model_ids: xored_ids}, options));

    return this;
  };

  /**
   * Resets the subset collection
   *
   * @param {Object} models
   * @param {Object} options
   * @return {Object} collection
   */
  Subset._resetSubset = function (options) {
    options = options || {};
    this.each(this._unbindModelEvents);
    this._reset();

    this.parent().each(function (model) {
      this._addToSubset(model, {silent: true});
    }, this);

    if (!options.silent) {
      this.trigger('reset', this, options);
    }

    return this;
  };

  /**
   * Adds a model into the parent collection
   *
   * @param {Object} model
   * @param {Object} options
   * @return {Object} model
   */
  Subset.add = function (model, options) {
    return this.parent().add(model, options);
  };

  /**
   * Adds a model into the subset collection
   *
   * @param {Object} model
   * @param {Object} options
   * @return {Object} model
   */
  Subset._addToSubset = function (model, options) {
    if (this.sieve(model)) {
      return Backbone.Collection.prototype.add.call(this, model, options);
    }
  };

  /**
   * Remove a model from the subset collection
   *
   * @param {Object} model
   * @param {Object} options
   * @return {Object} model
   */
  Subset.remove = function (model, options) {
    return this.parent().remove(model, options);
  };

  /**
   * Removes a model from the subset collection
   *
   * @param {Object} model
   * @param {Object} options
   * @return {Object} model
   */
  Subset._removeFromSubset = function (model, options) {
    return Backbone.Collection.prototype.remove.call(this, model, options);
  }

  /**
   * Prepare a model to be added to a collection
   *
   * @param {Object} model
   * @param {Object} options
   * @return {Object} model
   */
  Subset._prepareModel = function (model, options) {
    if (!(model instanceof Backbone.Model)) {
      var attrs = model;
      model = new this.model(attrs, {collection: this.parent()});

      if (model.validate && !model._performValidation(model.attributes, options)) {
        model = false;
      }
    } else if (!model.collection) {
      model.collection = this.parent();
    }
    model = this.sieve(model) ? model : false;
    return model;
  };

  /**
   * Proxies an `add` event happening into the parent collection to the Subset
   *
   * @param {Object} model
   * @param {Object} collection
   * @param {Object} options
   */
  Subset._proxyAdd = function (model, collection, options) {
    options = options || {};

    if (collection !== this && this.sieve(model) && !options.noproxy) {
      this._addToSubset(model, options);
    }
  };

  /**
   * Proxies a `remove` event happening into the parent collection to the Subset
   *
   * @param {Object} model
   * @param {Object} collection
   * @param {Object} options
   */
  Subset._proxyRemove = function (model, collection, options) {
    options = options || {};

    if (collection !== this && this.sieve(model) && !options.noproxy) {
      this._removeFromSubset(model, options);
    }
  };

  /**
   * Proxies a `change` event happening into the parent collection to the Subset
   *
   * @param {Object} ev
   * @param {Object} model
   * @param {Object} collection
   */
  Subset._proxyChange = function (ev, model, collection) {
    if (collection !== this && ev === 'change' && this.liveupdate_keys === 'all') {
      this._updateModelMembership(model);
    } else if (ev.slice(0, 7) === 'change:' && _.isArray(this.liveupdate_keys)
               && _.include(this.liveupdate_keys, ev.slice(7))) {
      this._updateModelMembership(model);
    }
  };

  /**
   * Proxies a `reset` event happening into the parent collection to the Subset
   *
   * @param {Object} collection
   * @param {Object} options
   */
  Subset._proxyReset = function (collection, options) {
    options = options || {};
    var ids
      , sieved_ids
      , self = this;

    if (options.model_ids) {
      ids = _.intersection(this.pluck('id'), options.model_ids);
      sieved_ids = _.pluck(_.filter(ids, function (id) {
        return self.sieve(self.get(id));
      }), 'id');
    }

    if ((!options.model_ids || this === collection || sieved_ids.length) && (!options || !options.noproxy)) {
      this._resetSubset(_.extend(_.clone(options), {proxied: true}));
    }
  };

  /**
   * Determines whether a model should be in the subset, and adds or removes it
   *
   * @param {Object} model
   */
  Subset._updateModelMembership = function (model) {
    var hasId = !model.id
      , alreadyInSubset = this._byCid[model.cid] || (hasId && this._byId[model.id]);

    if (this.sieve(model)) {
      if (!alreadyInSubset) {
        this._addToSubset(model);
      }
    } else {
      if (alreadyInSubset) {
        this._removeFromSubset(model);
      }
    }
  };

  /**
   * Unbinds the _onModelEvent listener
   *
   * @param {Object} model
   */
  Subset._unbindModelEvents = function (model) {
    model.unbind('all', this._onModelEvent);
  };

  _.extend(Backbone.Subset.prototype, Backbone.Collection.prototype, Subset);
  Backbone.Subset.extend = Backbone.Collection.extend;
}());
