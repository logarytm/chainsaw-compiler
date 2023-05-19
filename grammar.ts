export type Location = {
    start: {
        line: number;
        column: number;
        offset: number;
    };
    end: {
        line: number;
        column: number;
        offset: number;
    };
};

type Node<TKind extends string, TExtra extends object = {}> = {
    kind: TKind;
    location: Location;
} & TExtra;

export type AnyNode = Node<string>;
