# Prerequisite: 
# conda install -c anaconda pillow

import argparse
import math
import numpy as np
from PIL import Image
import sys

def surface_value(args, r, d_sq):
    result = 0
    lo_sq = (r - args.thickness) * (r - args.thickness)
    hi_sq = (r + args.thickness) * (r + args.thickness)
    if (lo_sq <= d_sq) and (d_sq <= hi_sq):
        d = math.sqrt(d_sq)
        dr = math.fabs(d - r)
        dt = max(args.thickness - dr, 0)
        result = dt / args.thickness
    return result
    
def make(args):
    data_arrays = [np.zeros([args.height, args.width], dtype=np.uint16) for _ in range(args.depth)]

    cx = args.width / 2
    cy = args.height / 2
    cz = args.depth / 2
    r_sph = min(args.width, args.height, args.depth) / 3
    r_con1 = r_sph
    r_con2 = r_sph / 2
    r_cyl = r_sph / 6

    for z in range(args.depth):
        if (z % 10 == 0) or (z == args.depth - 1):
            print('z {}'.format(z))
        for y in range(args.height):
            for x in range(args.width):
                d_sph_sq = (x - cx) * (x - cx) + (y - cy) * (y - cy) + (z - cz) * (z - cz)
                surf_val_sph = surface_value(args, r_sph, d_sph_sq)
                if surf_val_sph > 0:
                    v = args.sphere_value * args.data_scale
                    if args.fade:
                        v *= surf_val_sph
                    data_arrays[z][y][x] = v

                # Cone 1 (fatter): along the x axis
                d_con1_sq = (y - cy) * (y - cy) + (z - cz) * (z - cz)
                r_con1_scaled = float(x) / args.height * r_con1
                surf_val_con1 = surface_value(args, r_con1_scaled, d_con1_sq)
                if surf_val_con1 > 0:
                    v = args.cone1_value * args.data_scale
                    if args.fade:
                        v *= surf_val_con1
                    data_arrays[z][y][x] = max(v, data_arrays[z][y][x])

                # Cone 2 (thinner): along the y axis
                d_con2_sq = (x - cx) * (x - cx) + (z - cz) * (z - cz)
                r_con2_scaled = float(y) / args.height * r_con2
                surf_val_con2 = surface_value(args, r_con2_scaled, d_con2_sq)
                if surf_val_con2 > 0:
                    v = args.cone2_value * args.data_scale
                    if args.fade:
                        v *= surf_val_con2
                    data_arrays[z][y][x] = max(v, data_arrays[z][y][x])

                # Cylinder: along the z axis
                d_cyl_sq = (x - cx) * (x - cx) + (y - cy) * (y - cy)
                surf_val_cyl = surface_value(args, r_cyl, d_cyl_sq)
                if surf_val_cyl > 0:
                    v = args.cylinder_value * args.data_scale
                    if args.fade:
                        v *= surf_val_cyl
                    data_arrays[z][y][x] = max(v, data_arrays[z][y][x])
    return data_arrays

def write(args, data_arrays):
    im = [Image.fromarray(a, "I;16") for a in data_arrays]
    sv = args.sphere_value
    co1v = args.cone1_value
    co2v = args.cone2_value
    cyv = args.cylinder_value
    w = args.width
    h = args.height
    d = args.depth
    th = args.thickness
    filename = 'sphere{}cone{}cone{}cylinder{}_w{}h{}d{}th{}.tif'.format(sv, co1v, co2v, cyv, w, h, d, th)

    print('writing {}...'.format(filename))
    im[0].save(filename, format='tiff', append_images=im[1:], save_all=True)
    print('done')

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.set_defaults(width=512)
    parser.add_argument('--width', '-sx', type=int, dest='width', help='volume width')
    parser.set_defaults(height=512)
    parser.add_argument('--height', '-sy', type=int, dest='height', help='volume height')
    parser.set_defaults(depth=512)
    parser.add_argument('--depth', '-sz', type=int, dest='depth', help='volume depth')
    parser.set_defaults(thickness=3)
    parser.add_argument('--thickness', '-t', type=int, dest='thickness', help='surface thickness')
    parser.set_defaults(sphere_value=64)
    parser.add_argument('--sphere_value', '-sv', type=int, dest='sphere_value', help='sphere data value (0-255)')
    parser.set_defaults(cone1_value=96)
    parser.add_argument('--cone1_value', '-co1v', type=int, dest='cone1_value', help='cone 1 data value (0-255')
    parser.set_defaults(cone2_value=128)
    parser.add_argument('--cone2_value', '-co2v', type=int, dest='cone2_value', help='cone 2 data value (0-255')
    parser.set_defaults(cylinder_value=160)
    parser.add_argument('--cylinder_value', '-cyv', type=int, dest='cylinder_value', help='cylinder data value (0-255)')
    parser.set_defaults(data_scale=16)
    parser.add_argument('--data_scale', '-ds', type=int, dest='data_scale', help='data scale')
    parser.set_defaults(fade=True)
    parser.add_argument('--no_fade', '-nf', dest='fade', action='store_false', help='no fading over thickness')

    args = parser.parse_args()

    data_arrays = make(args)
    write(args, data_arrays)