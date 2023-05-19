import { Binding } from './contracts';

type Bindings = { [name: string]: Binding };

export class Scope {
    private readonly parent: Scope | null;
    // noinspection TypeScriptFieldCanBeMadeReadonly
    private bindings: Bindings;

    constructor(parent: Scope | null = null, bindings: Bindings = {}) {
        this.parent = parent;
        this.bindings = bindings;
    }

    lookup(name: string, error: (name: string) => never): Binding {
        if (this.bindings.hasOwnProperty(name)) {
            return this.bindings[name];
        }

        if (this.parent !== null) {
            return this.parent.lookup(name, error);
        }

        error(name);
    }

    bind(name: string, binding: Binding, alreadyBound: (binding: Binding) => void): void {
        if (this.bindings.hasOwnProperty(name)) {
            alreadyBound(this.bindings[name]);
        }

        this.bindings[name] = binding;
    }

    extend(newBindings: Bindings = {}) {
        return new Scope(this, newBindings);
    }
}

exports.Scope = Scope;
