export class Scope {
    private parent: any;
    private bindings: any;

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

    bind(name, binding, alreadyBound) {
        if (this.bindings.hasOwnProperty(name)) {
            alreadyBound(this.bindings[name]);
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