import { test, expect } from 'bun:test';
import Engine from '../engine.js';
import { Logger } from '../logger.js';
import DeepseekModel, { Choice } from './deepseek.js';

class DeepseekMock extends DeepseekModel {}

function mockdModel(): DeepseekModel {
  const engine = new Engine(new Logger());
  return new DeepseekMock(engine, new Logger(), {});
}

function mockChoice(content: string, toolCalls?: Choice['message']['tool_calls']): Choice {
  return {
    finish_reason: 'stop',
    index: 0,
    message: { role: 'assistant', content, tool_calls: toolCalls },
  };
}

// ==================== DSML tool_calls ====================

test('prepChoice extracts DSML tool_calls and strips the tags from content', () => {
  const model = mockdModel();
  const content = [
    'Here is the file:',
    '<tool_calls>',
    '<invoke name="read">',
    '<parameter name="filePath" string="true">/tmp/x</parameter>',
    '</invoke>',
    '<invoke name="read">',
    '<parameter name="filePath" string="true">/tmp/y</parameter>',
    '<parameter name="offset" string="false">10</parameter>',
    '</invoke>',
    '</tool_calls>',
  ].join('\n');

  const result = model.prepChoice(mockChoice(content));

  expect(result.message.content).toBe('Here is the file:');
  expect(result.message.tool_calls!.length).toBe(2);
  expect(result.message.tool_calls![0]!.function.name).toBe('read');
  expect(result.message.tool_calls![0]!.function.arguments).toBe('{"filePath":"/tmp/x"}');
  expect(result.message.tool_calls![1]!.function.arguments).toBe('{"filePath":"/tmp/y","offset":"10"}');
});

test('prepChoice does not duplicate DSML tool_calls that already exist', () => {
  const model = mockdModel();
  const existing = [{
    id: 'call_abc',
    type: 'function',
    function: { name: 'read', arguments: '{"filePath":"/tmp/x"}' },
  }];
  const content = '<tool_calls><invoke name="read"><parameter name="filePath" string="true">/tmp/x</parameter></invoke></tool_calls>';

  const result = model.prepChoice(mockChoice(content, existing));

  expect(result.message.tool_calls!.length).toBe(1);
  expect(result.message.tool_calls![0]!.id).toBe('call_abc');
});

// ==================== text format ====================

test('prepChoice trims content', () => {
  const model = mockdModel();

  const result = model.prepChoice(mockChoice('  hello world  '));

  expect(result.message.content).toBe('hello world');
});
