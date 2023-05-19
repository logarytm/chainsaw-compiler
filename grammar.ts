// Keep this file in sync with parse.pegjs!

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

export type Program = TopLevelStatement[];

export type TopLevelStatement = FunctionDeclaration | FunctionDefinition | VariableDeclaration;

export type FunctionDeclaration = Node<'FunctionDeclaration', {
    functionName: string;
    callingConvention: CallingConventionSpecifier;
    parameters: ParameterList;
    returnType: Type;
}>;

export type FunctionDefinition = Node<'FunctionDefinition', {
    functionName: string;
    callingConvention: CallingConventionSpecifier;
    parameters: ParameterList;
    returnType: Type;
    body: FunctionBody;
}>;

export type CallingConventionSpecifier = 'stdcall' | 'fastcall';

export type ParameterList = NameTypePair[];

export type NameTypePair = Node<'NameTypePair', {
    name: string;
    type: Type;
}>;

export type Body = Node<'Body', {
    statements: Statement[],
}>;

export type FunctionBody = Node<'Body', {
    statements: FunctionStatement[],
}>;

export type FunctionStatement = VariableDeclaration | Statement;

export type VariableDeclaration = Node<'VariableDeclaration', {
    variableName: Identifier;
    variableType: Type;
    initialValue: Expression | null;
}>;

export type Statement
    = EmptyInstruction | ReturnStatement | ConditionalStatement
    | LoopingStatement | InlineAssembler | ExpressionStatement;

export type ReturnStatement = Node<'ReturnStatement', {
    expression: Expression;
}>;

export type ConditionalStatement = Node<'ConditionalStatement', {
    predicate: Expression;
    thenBranch: Body;
    elseBranch: Body;
}>;

export type LoopingStatement = Node<'LoopingStatement', {
    predicate: Expression;
    body: Body;
}>;

export type InlineAssembler = Node<'InlineAssembler', {
    instructions: string;
}>;

export type ExpressionStatement = Node<'ExpressionStatement', {
    expression: Expression;
}>;

export type EmptyInstruction = Node<'EmptyInstruction'>;

export type Type = PointerType | ArrayType | NamedType;

export type PointerType = Node<'PointerType', {
    type: Type;
}>;

export type ArrayType = Node<'ArrayType', {
    capacity: number;
    type: Type;
}>;

export type NamedType = Node<'NamedType', {
    name: string;
}>;

export type Expression = PrimaryExpression | BinaryOperator;

export type BinaryOperator = Node<'BinaryOperator', {
    lhs: Expression;
    operator: BinaryToken;
    rhs: Expression;
}>;

export type PrimaryExpression = ArrayDereference | FunctionApplication | SecondaryExpression;

export type SecondaryExpression = Expression | UnaryOperator | Identifier | NumberLiteral | StringLiteral;

export type UnaryOperator = Node<'UnaryOperator', {
    operator: UnaryToken;
    operand: PrimaryExpression;
}>;

export type FunctionApplication = Node<'FunctionApplication', {
    function: Expression;
    args: ArgumentList;
}>;

export type ArrayDereference = Node<'ArrayDereference', {
    array: Expression;
    offset: PrimaryExpression;
}>;

export type ArgumentList = Expression[];

export type Identifier = Node<'Identifier', {
    name: string;
}>;

export type NumberLiteral = Node<'Number', {
    value: number;
}>;

export type StringLiteral = Node<'String', {
    string: string;
}>;

type UnaryToken = string;
type BinaryToken = string;
