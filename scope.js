class Scope {
    constructor(parent = null) {
        this.parent = parent;
        this.bindings = {};
    }

    lookup(name, error) {
        if (this.bindings.hasOwnProperty(name)) {
            return this.bindings[name];
        }

        if (this.parent !== null) {
            return this.parent.lookup(name, error);
        }

        return error(name);
    }

    bind(name, binding, error) {
        if (this.bindings.hasOwnProperty(name)) {
            error();
        }

        this.bindings[name] = binding;
    }

    extend(newBindings = {}) {
        const childScope = new Scope(this);
        childScope.bindings = newBindings;

        return childScope;
    }
}

exports.Scope = Scope;