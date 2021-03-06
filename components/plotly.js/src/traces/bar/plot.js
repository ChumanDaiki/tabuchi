/**
* Copyright 2012-2019, Plotly, Inc.
* All rights reserved.
*
* This source code is licensed under the MIT license found in the
* LICENSE file in the root directory of this source tree.
*/


'use strict';

var d3 = require('d3');
var isNumeric = require('fast-isnumeric');

var Lib = require('../../lib');
var svgTextUtils = require('../../lib/svg_text_utils');

var Color = require('../../components/color');
var Drawing = require('../../components/drawing');
var Registry = require('../../registry');

var attributes = require('./attributes');
var attributeText = attributes.text;
var attributeTextPosition = attributes.textposition;
var helpers = require('./helpers');
var style = require('./style');

// padding in pixels around text
var TEXTPAD = 3;

module.exports = function plot(gd, plotinfo, cdModule, traceLayer) {
    var xa = plotinfo.xaxis;
    var ya = plotinfo.yaxis;
    var fullLayout = gd._fullLayout;

    var bartraces = Lib.makeTraceGroups(traceLayer, cdModule, 'trace bars').each(function(cd) {
        var plotGroup = d3.select(this);
        var cd0 = cd[0];
        var trace = cd0.trace;

        var adjustDir;
        var adjustPixel = 0;
        if(trace.type === 'waterfall' && trace.connector.visible && trace.connector.mode === 'between') {
            adjustPixel = trace.connector.line.width / 2;
        }

        var isHorizontal = (trace.orientation === 'h');

        if(!plotinfo.isRangePlot) cd0.node3 = plotGroup;

        var pointGroup = Lib.ensureSingle(plotGroup, 'g', 'points');

        var bars = pointGroup.selectAll('g.point').data(Lib.identity);

        bars.enter().append('g')
            .classed('point', true);

        bars.exit().remove();

        bars.each(function(di, i) {
            var bar = d3.select(this);

            // now display the bar
            // clipped xf/yf (2nd arg true): non-positive
            // log values go off-screen by plotwidth
            // so you see them continue if you drag the plot
            var x0, x1, y0, y1;
            if(isHorizontal) {
                y0 = ya.c2p(di.p0, true);
                y1 = ya.c2p(di.p1, true);
                x0 = xa.c2p(di.s0, true);
                x1 = xa.c2p(di.s1, true);

                // for selections
                di.ct = [x1, (y0 + y1) / 2];
            } else {
                x0 = xa.c2p(di.p0, true);
                x1 = xa.c2p(di.p1, true);
                y0 = ya.c2p(di.s0, true);
                y1 = ya.c2p(di.s1, true);

                // for selections
                di.ct = [(x0 + x1) / 2, y1];
            }

            var isBlank = di.isBlank = (
                !isNumeric(x0) || !isNumeric(x1) ||
                !isNumeric(y0) || !isNumeric(y1) ||
                x0 === x1 || y0 === y1
            );

            // in waterfall mode `between` we need to adjust bar end points to match the connector width
            if(adjustPixel) {
                if(isHorizontal) {
                    adjustDir = (x1 < x0) ? -1 : 1;
                    x0 -= adjustDir * adjustPixel;
                    x1 += adjustDir * adjustPixel;
                } else {
                    adjustDir = (y1 < y0) ? -1 : 1;
                    y0 -= adjustDir * adjustPixel;
                    y1 += adjustDir * adjustPixel;
                }
            }

            var lw;
            var mc;
            var prefix;

            if(trace.type === 'waterfall') {
                var cont = trace[di.dir].marker;
                lw = cont.line.width;
                mc = cont.color;
                prefix = 'waterfall';
            } else {
                lw = (di.mlw + 1 || trace.marker.line.width + 1 ||
                    (di.trace ? di.trace.marker.line.width : 0) + 1) - 1;
                mc = di.mc || trace.marker.color;
                prefix = 'bar';
            }

            var offset = d3.round((lw / 2) % 1, 2);
            var bargap = fullLayout[prefix + 'gap'];
            var bargroupgap = fullLayout[prefix + 'groupgap'];

            function roundWithLine(v) {
                // if there are explicit gaps, don't round,
                // it can make the gaps look crappy
                return (bargap === 0 && bargroupgap === 0) ?
                    d3.round(Math.round(v) - offset, 2) : v;
            }

            function expandToVisible(v, vc) {
                // if it's not in danger of disappearing entirely,
                // round more precisely
                return Math.abs(v - vc) >= 2 ? roundWithLine(v) :
                // but if it's very thin, expand it so it's
                // necessarily visible, even if it might overlap
                // its neighbor
                (v > vc ? Math.ceil(v) : Math.floor(v));
            }

            if(!gd._context.staticPlot) {
                // if bars are not fully opaque or they have a line
                // around them, round to integer pixels, mainly for
                // safari so we prevent overlaps from its expansive
                // pixelation. if the bars ARE fully opaque and have
                // no line, expand to a full pixel to make sure we
                // can see them

                var op = Color.opacity(mc);
                var fixpx = (op < 1 || lw > 0.01) ? roundWithLine : expandToVisible;
                x0 = fixpx(x0, x1);
                x1 = fixpx(x1, x0);
                y0 = fixpx(y0, y1);
                y1 = fixpx(y1, y0);
            }

            Lib.ensureSingle(bar, 'path')
                .style('vector-effect', 'non-scaling-stroke')
                .attr('d', isBlank ? 'M0,0Z' : 'M' + x0 + ',' + y0 + 'V' + y1 + 'H' + x1 + 'V' + y0 + 'Z')
                .call(Drawing.setClipUrl, plotinfo.layerClipId, gd);

            appendBarText(gd, bar, cd, i, x0, x1, y0, y1);

            if(plotinfo.layerClipId) {
                Drawing.hideOutsideRangePoint(di, bar.select('text'), xa, ya, trace.xcalendar, trace.ycalendar);
            }
        });

        // lastly, clip points groups of `cliponaxis !== false` traces
        // on `plotinfo._hasClipOnAxisFalse === true` subplots
        var hasClipOnAxisFalse = cd0.trace.cliponaxis === false;
        Drawing.setClipUrl(plotGroup, hasClipOnAxisFalse ? null : plotinfo.layerClipId, gd);
    });

    // error bars are on the top
    Registry.getComponentMethod('errorbars', 'plot')(gd, bartraces, plotinfo);
};

function appendBarText(gd, bar, calcTrace, i, x0, x1, y0, y1) {
    var fullLayout = gd._fullLayout;
    var textPosition;

    function appendTextNode(bar, text, textFont) {
        var textSelection = Lib.ensureSingle(bar, 'text')
            .text(text)
            .attr({
                'class': 'bartext bartext-' + textPosition,
                transform: '',
                'text-anchor': 'middle',
                // prohibit tex interpretation until we can handle
                // tex and regular text together
                'data-notex': 1
            })
            .call(Drawing.font, textFont)
            .call(svgTextUtils.convertToTspans, gd);

        return textSelection;
    }

    // get trace attributes
    var trace = calcTrace[0].trace;
    var orientation = trace.orientation;

    var text = getText(trace, i);
    textPosition = getTextPosition(trace, i);

    // compute text position
    var prefix = trace.type === 'waterfall' ? 'waterfall' : 'bar';
    var barmode = fullLayout[prefix + 'mode'];
    var inStackOrRelativeMode = barmode === 'stack' || barmode === 'relative';

    var calcBar = calcTrace[i];
    var isOutmostBar = !inStackOrRelativeMode || calcBar._outmost;

    if(!text || textPosition === 'none' ||
        (calcBar.isBlank && (textPosition === 'auto' || textPosition === 'inside'))) {
        bar.select('text').remove();
        return;
    }

    var layoutFont = fullLayout.font;
    var barColor = style.getBarColor(calcTrace[i], trace);
    var insideTextFont = style.getInsideTextFont(trace, i, layoutFont, barColor);
    var outsideTextFont = style.getOutsideTextFont(trace, i, layoutFont);

    // padding excluded
    var barWidth = Math.abs(x1 - x0) - 2 * TEXTPAD;
    var barHeight = Math.abs(y1 - y0) - 2 * TEXTPAD;

    var textSelection;
    var textBB;
    var textWidth;
    var textHeight;

    if(textPosition === 'outside') {
        if(!isOutmostBar && !calcBar.hasB) textPosition = 'inside';
    }

    if(textPosition === 'auto') {
        if(isOutmostBar) {
            // draw text using insideTextFont and check if it fits inside bar
            textPosition = 'inside';
            textSelection = appendTextNode(bar, text, insideTextFont);

            textBB = Drawing.bBox(textSelection.node()),
            textWidth = textBB.width,
            textHeight = textBB.height;

            var textHasSize = (textWidth > 0 && textHeight > 0);
            var fitsInside = (textWidth <= barWidth && textHeight <= barHeight);
            var fitsInsideIfRotated = (textWidth <= barHeight && textHeight <= barWidth);
            var fitsInsideIfShrunk = (orientation === 'h') ?
                (barWidth >= textWidth * (barHeight / textHeight)) :
                (barHeight >= textHeight * (barWidth / textWidth));

            if(textHasSize &&
                    (fitsInside || fitsInsideIfRotated || fitsInsideIfShrunk)) {
                textPosition = 'inside';
            } else {
                textPosition = 'outside';
                textSelection.remove();
                textSelection = null;
            }
        } else {
            textPosition = 'inside';
        }
    }

    if(!textSelection) {
        textSelection = appendTextNode(bar, text,
                (textPosition === 'outside') ?
                outsideTextFont : insideTextFont);

        textBB = Drawing.bBox(textSelection.node()),
        textWidth = textBB.width,
        textHeight = textBB.height;

        if(textWidth <= 0 || textHeight <= 0) {
            textSelection.remove();
            return;
        }
    }

    // compute text transform
    var transform, constrained;
    if(textPosition === 'outside') {
        constrained = trace.constraintext === 'both' || trace.constraintext === 'outside';
        transform = getTransformToMoveOutsideBar(x0, x1, y0, y1, textBB,
            orientation, constrained);
    } else {
        constrained = trace.constraintext === 'both' || trace.constraintext === 'inside';
        transform = getTransformToMoveInsideBar(x0, x1, y0, y1, textBB,
            orientation, constrained);
    }

    textSelection.attr('transform', transform);
}

function getTransformToMoveInsideBar(x0, x1, y0, y1, textBB, orientation, constrained) {
    // compute text and target positions
    var textWidth = textBB.width;
    var textHeight = textBB.height;
    var textX = (textBB.left + textBB.right) / 2;
    var textY = (textBB.top + textBB.bottom) / 2;
    var barWidth = Math.abs(x1 - x0);
    var barHeight = Math.abs(y1 - y0);
    var targetWidth;
    var targetHeight;
    var targetX;
    var targetY;

    // apply text padding
    var textpad;
    if(barWidth > (2 * TEXTPAD) && barHeight > (2 * TEXTPAD)) {
        textpad = TEXTPAD;
        barWidth -= 2 * textpad;
        barHeight -= 2 * textpad;
    } else textpad = 0;

    // compute rotation and scale
    var rotate,
        scale;

    if(textWidth <= barWidth && textHeight <= barHeight) {
        // no scale or rotation is required
        rotate = false;
        scale = 1;
    } else if(textWidth <= barHeight && textHeight <= barWidth) {
        // only rotation is required
        rotate = true;
        scale = 1;
    } else if((textWidth < textHeight) === (barWidth < barHeight)) {
        // only scale is required
        rotate = false;
        scale = constrained ? Math.min(barWidth / textWidth, barHeight / textHeight) : 1;
    } else {
        // both scale and rotation are required
        rotate = true;
        scale = constrained ? Math.min(barHeight / textWidth, barWidth / textHeight) : 1;
    }

    if(rotate) rotate = 90;  // rotate clockwise

    // compute text and target positions
    if(rotate) {
        targetWidth = scale * textHeight;
        targetHeight = scale * textWidth;
    } else {
        targetWidth = scale * textWidth;
        targetHeight = scale * textHeight;
    }

    if(orientation === 'h') {
        if(x1 < x0) {
            // bar end is on the left hand side
            targetX = x1 + textpad + targetWidth / 2;
            targetY = (y0 + y1) / 2;
        } else {
            targetX = x1 - textpad - targetWidth / 2;
            targetY = (y0 + y1) / 2;
        }
    } else {
        if(y1 > y0) {
            // bar end is on the bottom
            targetX = (x0 + x1) / 2;
            targetY = y1 - textpad - targetHeight / 2;
        } else {
            targetX = (x0 + x1) / 2;
            targetY = y1 + textpad + targetHeight / 2;
        }
    }

    return getTransform(textX, textY, targetX, targetY, scale, rotate);
}

function getTransformToMoveOutsideBar(x0, x1, y0, y1, textBB, orientation, constrained) {
    var barWidth = (orientation === 'h') ?
        Math.abs(y1 - y0) :
        Math.abs(x1 - x0);
    var textpad;

    // Keep the padding so the text doesn't sit right against
    // the bars, but don't factor it into barWidth
    if(barWidth > 2 * TEXTPAD) {
        textpad = TEXTPAD;
    }

    // compute rotation and scale
    var scale = 1;
    if(constrained) {
        scale = (orientation === 'h') ?
            Math.min(1, barWidth / textBB.height) :
            Math.min(1, barWidth / textBB.width);
    }

    // compute text and target positions
    var textX = (textBB.left + textBB.right) / 2;
    var textY = (textBB.top + textBB.bottom) / 2;
    var targetWidth;
    var targetHeight;
    var targetX;
    var targetY;

    targetWidth = scale * textBB.width;
    targetHeight = scale * textBB.height;

    if(orientation === 'h') {
        if(x1 < x0) {
            // bar end is on the left hand side
            targetX = x1 - textpad - targetWidth / 2;
            targetY = (y0 + y1) / 2;
        } else {
            targetX = x1 + textpad + targetWidth / 2;
            targetY = (y0 + y1) / 2;
        }
    } else {
        if(y1 > y0) {
            // bar end is on the bottom
            targetX = (x0 + x1) / 2;
            targetY = y1 + textpad + targetHeight / 2;
        } else {
            targetX = (x0 + x1) / 2;
            targetY = y1 - textpad - targetHeight / 2;
        }
    }

    return getTransform(textX, textY, targetX, targetY, scale, false);
}

function getTransform(textX, textY, targetX, targetY, scale, rotate) {
    var transformScale;
    var transformRotate;
    var transformTranslate;

    if(scale < 1) transformScale = 'scale(' + scale + ') ';
    else {
        scale = 1;
        transformScale = '';
    }

    transformRotate = (rotate) ?
        'rotate(' + rotate + ' ' + textX + ' ' + textY + ') ' : '';

    // Note that scaling also affects the center of the text box
    var translateX = (targetX - scale * textX);
    var translateY = (targetY - scale * textY);
    transformTranslate = 'translate(' + translateX + ' ' + translateY + ')';

    return transformTranslate + transformScale + transformRotate;
}

function getText(trace, index) {
    var value = helpers.getValue(trace.text, index);
    return helpers.coerceString(attributeText, value);
}

function getTextPosition(trace, index) {
    var value = helpers.getValue(trace.textposition, index);
    return helpers.coerceEnumerated(attributeTextPosition, value);
}
