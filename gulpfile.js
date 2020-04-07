var gulp = require('gulp');
var mocha = require('gulp-mocha');
 
gulp.task('default', function () {
  return gulp.src('tests/*.js', {read: false})
    .pipe(mocha({reporter: 'spec'}));
});

gulp.task('jtest', function () {
  return gulp.src('tests/image-helpers-spec.js', {read: false})
    .pipe(mocha({reporter: 'spec'}));
});