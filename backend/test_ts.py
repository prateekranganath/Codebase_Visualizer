import tree_sitter
import tree_sitter_javascript as tsjs

JS_LANGUAGE = tree_sitter.Language(tsjs.language())
parser = tree_sitter.Parser(JS_LANGUAGE)

code = b"""
import { foo } from 'bar';

class MyClass extends BaseClass {
    constructor() {
        super();
        this.value = 1;
    }
    
    myMethod(x) {
        return foo(x);
    }
}

export function baz(y) {
    const obj = new MyClass();
    obj.myMethod(y);
}
"""

tree = parser.parse(code)
cursor = tree.walk()

def print_tree(cursor, indent=0):
    node = cursor.node
    print("  " * indent + f"{node.type} ({node.start_point}-{node.end_point})")
    if cursor.goto_first_child():
        print_tree(cursor, indent + 1)
        while cursor.goto_next_sibling():
            print_tree(cursor, indent + 1)
        cursor.goto_parent()

print_tree(cursor)
