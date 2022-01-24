import { ArgTypeDefinition } from '@mui/studio-core';
import * as prettier from 'prettier';
import parserBabel from 'prettier/parser-babel';
import { getStudioComponent } from './studioComponents';
import * as studioDom from './studioDom';
import {
  NodeId,
  PropExpression,
  RenderContext,
  ResolvedProps,
  StudioComponentDefinition,
  StudioNodeProps,
} from './types';
import { ExactEntriesOf } from './utils/types';

export interface RenderPageConfig {
  // whether we're in the context of an editor
  editor: boolean;
  // prettify output
  pretty: boolean;
}

interface Import {
  named: Map<string, string>;
  all?: string;
}

class Context implements RenderContext {
  private dom: studioDom.StudioDom;

  private page: studioDom.StudioPageNode;

  private editor: boolean;

  private imports: Map<string, Import>;

  private dataLoaders: string[] = [];

  constructor(
    dom: studioDom.StudioDom,
    page: studioDom.StudioPageNode,
    { editor }: RenderPageConfig,
  ) {
    this.dom = dom;
    this.page = page;
    this.editor = editor;

    this.imports = new Map<string, Import>([
      [
        'react',
        {
          named: new Map([['default', 'React']]),
        },
      ],
    ]);

    if (this.editor) {
      this.imports.set('@mui/studio-core/runtime', {
        named: new Map(),
        all: '__studioRuntime',
      });
    }
  }

  useDataLoader(queryId: string): string {
    this.addImport('@mui/studio-core', 'useDataQuery', 'useDataQuery');
    this.dataLoaders.push(queryId);
    return `_${queryId}`;
  }

  getComponentDefinition(node: studioDom.StudioNode): StudioComponentDefinition | null {
    if (studioDom.isPage(node)) {
      return getStudioComponent(this.dom, 'Page');
    }
    if (studioDom.isElement(node)) {
      return getStudioComponent(this.dom, node.component);
    }
    return null;
  }

  /**
   * Resolves StudioNode properties to expressions we can render in the code.
   * This will set up databinding if necessary
   */
  resolveProps<P>(
    node: studioDom.StudioElementNode | studioDom.StudioPageNode,
    resolvedChildren: ResolvedProps,
  ): ResolvedProps {
    const result: ResolvedProps = resolvedChildren;
    const component = this.getComponentDefinition(node);
    (Object.entries(node.props) as ExactEntriesOf<StudioNodeProps<P>>).forEach(
      ([propName, propValue]) => {
        const argDef: ArgTypeDefinition | undefined = component?.argTypes[propName];
        if (!argDef || !propValue || typeof propName !== 'string' || result[propName]) {
          return;
        }

        if (argDef.typeDef.type === 'dataQuery') {
          if (propValue.type !== 'const') {
            throw new Error(`TODO: make this work for bindings`);
          }
          if (propValue.value && typeof propValue.value === 'string') {
            const spreadedValue = this.useDataLoader(propValue.value);
            result.$spread = `${result.$spread ? `${result.$spread} ` : ''}{...${spreadedValue}}`;
          }
        } else if (propValue.type === 'const') {
          result[propName] = {
            type: 'expression',
            value: JSON.stringify(propValue.value),
          };
        } else if (propValue.type === 'binding') {
          result[propName] = {
            type: 'expression',
            value: `_${propValue.state}`,
          };
          if (argDef.onChangeProp) {
            const setStateIdentifier = `set_${propValue.state}`;
            if (argDef.onChangeHandler) {
              // TODO: React.useCallback for this one?
              const { params, valueGetter } = argDef.onChangeHandler;
              result[argDef.onChangeProp] = {
                type: 'expression',
                value: `(${params.join(', ')}) => ${setStateIdentifier}(${valueGetter})`,
              };
            } else {
              result[argDef.onChangeProp] = {
                type: 'expression',
                value: setStateIdentifier,
              };
            }
          }
        } else {
          throw new Error(`Invariant: Unkown prop type "${(propValue as any).type}"`);
        }
      },
    );

    return result;
  }

  renderComponent(name: string, resolvedProps: ResolvedProps): string {
    const { children, ...props } = resolvedProps;
    return children
      ? `<${name} ${this.renderProps(props)}>${this.renderJsxContent(children)}</${name}>`
      : `<${name} ${this.renderProps(props)}/>`;
  }

  renderNodeChildren(node: studioDom.StudioElementNode | studioDom.StudioPageNode): ResolvedProps {
    const result: ResolvedProps = {};
    const nodeChildren = studioDom.getChildNodes(this.dom, node);
    // eslint-disable-next-line no-restricted-syntax
    for (const [prop, children] of Object.entries(nodeChildren)) {
      if (children) {
        if (children.length === 1) {
          result[prop] = this.renderNode(children[0]);
        } else if (children.length > 1) {
          result[prop] = {
            type: 'jsxFragment',
            value: children
              .map((child): string => this.renderJsxContent(this.renderNode(child)))
              .join('\n'),
          };
        }
      }
    }

    const component = this.getComponentDefinition(node);

    if (this.editor && component) {
      // eslint-disable-next-line no-restricted-syntax
      for (const [prop, argType] of Object.entries(component.argTypes)) {
        if (argType?.typeDef.type === 'element') {
          if (argType.control?.type === 'slots') {
            const existingProp = result[prop];

            result[prop] = {
              type: 'jsxElement',
              value: `
                <__studioRuntime.Slots prop=${JSON.stringify(prop)}>
                  ${existingProp ? this.renderJsxContent(existingProp) : ''}
                </__studioRuntime.Slots>
              `,
            };
          } else if (argType.control?.type === 'slot') {
            const existingProp = result[prop];

            result[prop] = {
              type: 'jsxElement',
              value: `
                <__studioRuntime.Placeholder prop=${JSON.stringify(prop)}>
                  ${existingProp ? this.renderJsxContent(existingProp) : ''}
                </__studioRuntime.Placeholder>
              `,
            };
          }
        }
      }
    }

    return result;
  }

  renderNode(node: studioDom.StudioElementNode | studioDom.StudioPageNode): PropExpression {
    const component = this.getComponentDefinition(node);
    if (!component) {
      return {
        type: 'expression',
        value: 'null',
      };
    }

    const nodeChildren = this.renderNodeChildren(node);
    const resolvedProps = this.resolveProps(node, nodeChildren);
    const rendered = component.render(this, resolvedProps);

    // TODO: We may not need the `component` prop anymore. Remove?
    return {
      type: 'jsxElement',
      value: this.editor
        ? `
          <__studioRuntime.WrappedStudioNode id="${node.id}">
            ${rendered}
          </__studioRuntime.WrappedStudioNode>
        `
        : rendered,
    };
  }

  /**
   * Renders a node to a string that can be inlined as the return value of a React component
   * @example
   * `function Hello () {
   *   return ${RESULT};
   * }`
   */
  renderRoot(node: studioDom.StudioPageNode): string {
    const expr = this.renderNode(node);
    return this.renderJsExpression(expr);
  }

  /**
   * Renders resolved properties to a string that can be inlined as JSX attrinutes
   * @example `<Hello ${RESULT} />`
   */
  renderProps(resolvedProps: ResolvedProps): string {
    return (Object.entries(resolvedProps) as ExactEntriesOf<ResolvedProps>)
      .map(([name, expr]) => {
        if (!expr) {
          return '';
        }
        if (name === '$spread') {
          return expr;
        }
        return `${name}={${this.renderJsExpression(expr)}}`;
      })
      .join(' ');
  }

  /**
   * Renders an expression to a string that can be used as a javascript
   * expression. e.g. as the RHS of an assignment statement
   * @example `const hello = ${RESULT}`
   */
  // eslint-disable-next-line class-methods-use-this
  renderJsExpression(expr?: PropExpression): string {
    if (!expr) {
      return 'undefined';
    }
    if (expr.type === 'jsxFragment') {
      return `<>${expr.value}</>`;
    }
    return expr.value;
  }

  /**
   * Renders an expression to a string that can be inlined as children in
   * a JSX element.
   * @example `<Hello>${RESULT}</Hello>`
   */
  renderJsxContent(expr?: PropExpression): string {
    if (!expr) {
      return '';
    }
    if (expr.type === 'jsxElement' || expr.type === 'jsxFragment') {
      return expr.value;
    }
    return `{${this.renderJsExpression(expr)}}`;
  }

  /**
   * Adds an import to the page module. Returns an identifier that's based on local that can
   * be used to reference the import.
   */
  addImport(source: string, imported: string, localName: string = imported): string {
    // TODO: introduce concept of scope and make sure local is unique

    let specifiers = this.imports.get(source);
    if (!specifiers) {
      specifiers = { named: new Map() };
      this.imports.set(source, specifiers);
    }

    const existing = specifiers.named.get(imported);
    if (!existing) {
      specifiers.named.set(imported, localName);
    } else if (existing !== localName) {
      // TODO: we can reassign to a local variable
      throw new Error(
        `Trying to import "${imported}" as "${localName}" but it is already imported as "${existing}"`,
      );
    }

    return localName;
  }

  renderImports(): string {
    return Array.from(this.imports.entries(), ([source, specifiers]) => {
      const renderedSpecifiers = [];
      if (specifiers.named.size > 0) {
        const renderedNamedSpecifiers = [];
        // eslint-disable-next-line no-restricted-syntax
        for (const [imported, local] of specifiers.named.entries()) {
          if (imported === 'default') {
            renderedSpecifiers.push(local);
          } else {
            renderedNamedSpecifiers.push(imported === local ? imported : `${imported} as ${local}`);
          }
        }

        if (renderedNamedSpecifiers.length > 0) {
          renderedSpecifiers.push(`{ ${renderedNamedSpecifiers.join(', ')} }`);
        }
      }

      if (specifiers.all) {
        renderedSpecifiers.push(`* as ${specifiers.all}`);
      }
      return `import ${renderedSpecifiers.join(', ')} from '${source}';`;
    }).join('\n');
  }

  renderStateHooks(): string {
    return Object.entries(this.page.state)
      .map(([key, state]) => {
        // TODO: figure out proper variable naming
        return `const [_${key}, set_${key}] = React.useState(${JSON.stringify(
          state.initialValue,
        )});`;
      })
      .join('\n');
  }

  renderDataLoaderHooks(): string {
    return this.dataLoaders
      .map((queryId) => {
        return `const _${queryId} = useDataQuery(${JSON.stringify(queryId)});`;
      })
      .join('\n');
  }
}

export default function renderPageCode(
  dom: studioDom.StudioDom,
  pageNodeId: NodeId,
  configInit: Partial<RenderPageConfig> = {},
) {
  const config: RenderPageConfig = {
    editor: false,
    pretty: false,
    ...configInit,
  };

  const page = studioDom.getNode(dom, pageNodeId);
  studioDom.assertIsPage(page);
  const ctx = new Context(dom, page, config);
  const root: string = ctx.renderRoot(page);

  let code: string = `
    ${ctx.renderImports()}

    export default function App () {
      ${ctx.renderStateHooks()}
      ${ctx.renderDataLoaderHooks()}
      return (
        ${root}
      );
    }
  `;

  if (config.pretty) {
    code = prettier.format(code, {
      parser: 'babel-ts',
      plugins: [parserBabel],
    });
  }

  return { code };
}