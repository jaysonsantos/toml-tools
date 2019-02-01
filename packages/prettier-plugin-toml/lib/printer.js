const { BaseTomlCstVisitor } = require("@toml-tools/parser");
const { trimComment, collectComments } = require("./printer-utils");
const {
  concat,
  join,
  line,
  softline,
  indent,
  ifBreak,
  group
} = require("prettier").doc.builders;

class TomlBeautifierVisitor extends BaseTomlCstVisitor {
  constructor() {
    super();
    this.validateVisitor();

    // TODO: this methods should be defined on the prototype
    // defining as instance members **after** the validations to avoid
    // false positive errors on redundant methods
    this.mapVisit = elements => {
      if (elements === undefined) {
        // TODO: can optimize this by returning an immutable empty array singleton.
        return [];
      }

      return elements.map(this.visit, this);
    };

    this.getSingle = function(ctx) {
      const ctxKeys = Object.keys(ctx);
      if (ctxKeys.length !== 1) {
        throw Error(
          `Expecting single key CST ctx but found: <${ctxKeys.length}> keys`
        );
      }
      const singleElementKey = ctxKeys[0];
      const singleElementValues = ctx[singleElementKey];

      if (singleElementValues.length !== 1) {
        throw Error(
          `Expecting single item in CST ctx key but found: <${
            singleElementValues.length
          }> items`
        );
      }

      return singleElementValues[0];
    };

    this.visitSingle = function(ctx) {
      const singleElement = this.getSingle(ctx);
      return this.visit(singleElement);
    };

    // hack to get a reference to the inherited visit method from
    // the prototype because we cannot user "super.visit" inside the function
    // below
    const orgVisit = this.visit;
    this.visit = function(ctx, inParam) {
      if (ctx === undefined) {
        // empty Doc
        return "";
      }

      return orgVisit.call(this, ctx, inParam);
    };
  }

  toml(ctx) {
    // empty toml document
    if (ctx.expression === undefined) {
      return concat([line]);
    }

    function isTable(node) {
      return node.children.table !== undefined;
    }

    function isComment(node) {
      return node.children.Comment !== undefined;
    }

    const expsCsts = ctx.expression;
    const cstGroups = [];
    let currCstGroup = [];

    // TODO: EXTRACT to print utils?
    // Split the expressions into groups defined by the tables.
    for (let i = expsCsts.length - 1; i >= 0; i--) {
      const currCstNode = expsCsts[i];
      currCstGroup.push(currCstNode);
      if (isTable(currCstNode)) {
        let j = i - 1;
        let stillInComments = true;
        // add leading comments to the current group
        while (j >= 0 && stillInComments === true) {
          const priorCstNode = expsCsts[j];
          if (isComment(priorCstNode)) {
            currCstGroup.push(priorCstNode);
            j--;
            i--;
          } else {
            stillInComments = false;
          }
        }
        // scanning and adding items in reverse so we must now reverse the result
        currCstGroup.reverse();
        cstGroups.push(currCstGroup);
        currCstGroup = [];
      }
    }
    if (currCstGroup.length > 0) {
      currCstGroup.reverse();
      cstGroups.push(currCstGroup);
    }

    // once again adjust to scanning in reverse.
    cstGroups.reverse();
    const docGroups = cstGroups.map(currGroup => this.mapVisit(currGroup));
    // newlines between each group's elements
    const docGroupsInnerNewlines = docGroups.map(currGroup =>
      join(line, currGroup)
    );
    const docGroupsOuterNewlines = join(
      concat([line, line]),
      docGroupsInnerNewlines
    );
    return concat([
      docGroupsOuterNewlines,
      // Terminating newline
      line
    ]);
  }

  expression(ctx) {
    if (ctx.keyval) {
      let keyValDoc = this.visit(ctx.keyval);
      if (ctx.Comment) {
        const commentText = trimComment(ctx.Comment[0].image);
        keyValDoc = concat([keyValDoc, " " + commentText]);
      }
      return keyValDoc;
    } else if (ctx.table) {
      let tableDoc = this.visit(ctx.table);
      if (ctx.Comment) {
        const commentText = trimComment(ctx.Comment[0].image);
        tableDoc = concat([tableDoc, " " + commentText]);
      }
      return tableDoc;
    } else {
      return trimComment(ctx.Comment[0].image);
    }
  }

  keyval(ctx) {
    const keyDoc = this.visit(ctx.key);
    const valueDoc = this.visit(ctx.val);
    return concat([keyDoc, " = ", valueDoc]);
  }

  key(ctx) {
    const keyTexts = ctx.IKey.map(tok => tok.image);
    // TODO: inspect if the use of a quoted key was really needed
    //       and remove quotes if not.
    return join(".", keyTexts);
  }

  val(ctx) {
    const actualValueNode = this.getSingle(ctx);
    if (actualValueNode.image !== undefined) {
      // A Terminal
      return actualValueNode.image;
    } else {
      return this.visitSingle(ctx);
    }
  }

  array(ctx) {
    // TODO: handle comments
    let arrayValuesCst = ctx.arrayValues ? this.visit(ctx.arrayValues) : "";

    return group(concat(["[", indent(arrayValuesCst), softline, "]"]));
  }

  arrayValues(ctx) {
    // TODO: handle comments
    // TODO: respect dangling comma

    const values = ctx.val;
    const comments = collectComments(ctx.commentNewline);

    const valsDocs = this.mapVisit(ctx.val);
    return indent(concat([softline, join(concat([",", line]), valsDocs)]));
  }

  inlineTable(ctx) {}

  inlineTableKeyVals(ctx) {}

  table(ctx) {
    return this.visitSingle(ctx);
  }

  stdTable(ctx) {
    const keyDoc = this.visit(ctx.key);
    return concat(["[", keyDoc, "]"], line);
  }

  arrayTable(ctx) {
    const keyDoc = this.visit(ctx.key);
    return concat(["[[", keyDoc, "]]"], line);
  }

  nl(ctx) {
    // We do not currently care about newlines
    // Perhaps this will change in the future...
    throw Error("Should not get here!");
  }

  commentNewline(ctx) {}
}

const beautifierVisitor = new TomlBeautifierVisitor();

function print(path, options, print) {
  const cst = path.getValue();
  const doc = beautifierVisitor.visit(cst);
  return doc;
}

module.exports = {
  print
};
